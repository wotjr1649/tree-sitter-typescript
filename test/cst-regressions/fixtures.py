"""Load and verify the historical JavaScript inputs used by the CST harness."""

import argparse
import json
import re
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import urlopen

GAP = b'@gap@'
MANIFEST = Path(__file__).with_name('fixtures.jsonl')
COUNTS = {'typescript': (347, 1315, 968), 'tsx': (364, 1333, 969)}


def digest(data):
    return sha256(data).hexdigest()


def edit_source(source, step):
    start, end, text = step
    if not 0 <= start <= end <= len(source):
        raise ValueError('Edit outside the source')
    source[:start].decode('utf-8')
    source[end:].decode('utf-8')
    return source[:start] + text + source[end:]


def included_ranges(source):
    ranges, start = [], 0
    for part in source.split(GAP):
        if part:
            ranges.append((start, start + len(part)))
        start += len(part) + len(GAP)
    return ranges


def reviewed_steps(source, ranged=False):
    # Replay #76's edit schedule around the scanner marker nearest the midpoint.
    pivot = len(source) // 2
    start, distance = pivot, len(source) + 1
    for marker in (b'/*', b'//', b'<!--', b'-->', b'async', b'yield', b'static', b'get ', b'set ', b';', b'\n'):
        for offset in (source[:pivot].rfind(marker), source[pivot:].find(marker)):
            if offset < 0:
                continue
            for candidate in (offset, pivot + offset):
                if source.startswith(marker, candidate) and abs(candidate - pivot) < distance:
                    start, distance = candidate, abs(candidate - pivot)
    if ranged:
        start = source.index(GAP) + len(GAP)
    while start and start < len(source) and source[start] & 0xc0 == 0x80:
        start -= 1
    width = 0 if ranged and source.startswith(GAP, start) else len(source[start:].decode()[:1].encode())
    comment = b'/*review\n*/'
    offset = start + len(comment)
    middle = [(offset, offset + width, b''), (offset, offset, source[start:start + width])]
    if not width:
        middle = [(offset, offset, b'/'), (offset, offset + 1, b'')]
    return [(start, start, comment), *middle, (start, offset, b'')]


def yield_probe(name):
    family, newline, trivia, delegate = name.removeprefix('76/probes/yield/statement/').split('/')
    if delegate != 'delegate':
        raise ValueError(f'Unknown yield probe: {name}')
    nl = {'lf': '\n', 'cr': '\r', 'crlf': '\r\n', 'ls': '\u2028', 'ps': '\u2029'}[newline]
    between = {
        'bare': nl,
        'block': f' /*one{nl}two*/ ',
        'line': f' // one{nl} ',
        'chain': f' /*one*/ // two{nl} /*three*/ ',
    }[trivia]
    stmt = f'yield{between}*x;'
    source = {
        'object': f'({{ *g(){{{stmt}}}, async *h(){{{stmt}}} }});',
        'class': f'class C {{ *g(){{{stmt}}} static async *h(){{{stmt}}} }}',
        'field': f'class C {{ f = function*(){{{stmt}}}; static h = async function*(){{{stmt}}}; }}',
        'computed': f'function* g(){{ const key = yield 1; return {{ *[key](){{{stmt}}} }}; }}',
    }[family]
    return source.encode('utf-8')


def pinned_source(url, checksum, cache, offline):
    if not re.fullmatch(r'https://raw\.githubusercontent\.com/[\w.-]+/[\w.-]+/[0-9a-f]{40}/[\w./-]+', url):
        raise ValueError(f'Expected a raw GitHub URL pinned to a commit: {url}')
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / checksum
    if path.is_file():
        data = path.read_bytes()
    else:
        if offline:
            raise FileNotFoundError(f'Missing cached input {checksum} for {url}')
        with urlopen(url, timeout=30) as response:
            data = response.read()
        if digest(data) != checksum:
            raise ValueError(f'Unexpected SHA-256 from {url}')
        with NamedTemporaryFile(dir=cache, delete=False) as handle:
            handle.write(data)
            temporary = Path(handle.name)
        temporary.replace(path)
    if digest(data) != checksum:
        raise ValueError(f'Unexpected SHA-256 for cached input {path}')
    return data


def load(cache, *, offline=False):
    fixtures = {}
    for line in MANIFEST.read_bytes().splitlines():
        row = json.loads(line)
        name = row['id']
        if name in fixtures:
            raise ValueError(f'Duplicate regression input: {name}')
        expected = row['sha256']
        ranged = row.get('ranged', False)
        if 'url' in row:
            if not re.fullmatch(r'[a-f0-9]{64}', expected[0]):
                raise ValueError(f'Invalid source hash: {name}')
            source = pinned_source(row['url'], expected[0], cache, offline)
        elif row.get('generated'):
            source = yield_probe(name)
        else:
            source = row['source'].encode('utf-8')
        steps = [(start, end, text.encode('utf-8')) for start, end, text in row['edits']]
        if row.get('generated') and steps != reviewed_steps(source):
            raise ValueError(f'Invalid generated edit: {name}')
        if 'historical' in row:
            if (not row.get('generated') or len(row['historical']['sha256']) != len(expected)
                    or len(row['historical']['edits']) != len(steps) or expected == row['historical']['sha256']):
                raise ValueError(f'Invalid replacement mapping: {name}')
        if ranged and not included_ranges(source):
            raise ValueError(f'Empty included ranges: {name}')
        trial = source
        actual = [digest(trial)]
        visible = [digest(trial.replace(GAP, b''))] if ranged else None
        for i, step in enumerate(steps, 1):
            trial = edit_source(trial, step)
            actual.append(digest(trial))
            if ranged:
                if not included_ranges(trial):
                    raise ValueError(f'Empty included ranges: {name}#{i}')
                visible.append(digest(trial.replace(GAP, b'')))
        if actual != expected or visible != row.get('visible_sha256'):
            raise ValueError(f'Source or edit hash mismatch: {name}')
        fixtures[name] = (name, source, steps, ranged, row.get('tsx_only', False))

    for dialect, expected in COUNTS.items():
        edits = [len(steps) for _, _, steps, _, tsx_only in fixtures.values()
                 if dialect == 'tsx' or not tsx_only]
        if (len(edits), len(edits) + sum(edits), sum(edits)) != expected:
            raise ValueError(f'Incomplete {dialect} coverage')
    return tuple(fixtures.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='directory for SHA-256-addressed upstream inputs')
    parser.add_argument('--offline', action='store_true', help='verify without making network requests')
    args = parser.parse_args()
    fixtures = load(args.cache, offline=args.offline)
    print(f'Verified {len(fixtures)} JavaScript sequences')
    for dialect, (sequences, fresh, steps) in COUNTS.items():
        print(f'{dialect}: {sequences} sequences, {fresh} fresh CST pairs, {steps} edit steps')


if __name__ == '__main__':
    main()
