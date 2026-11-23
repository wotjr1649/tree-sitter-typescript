import json
import re
from dataclasses import dataclass
from pathlib import Path

from native import LANGUAGES, digest
from prepare import config_lines, example_folder
from regressions import GAP, edit_source

EXT = {'typescript': 'ts', 'tsx': 'tsx'}


@dataclass(frozen=True)
class Case:
    group: str
    name: str
    dialect: str
    data: bytes | Path
    verdict: dict | None = None

    def source(self):
        return self.data.read_bytes() if isinstance(self.data, Path) else self.data


def oracle(root, compiler_lock):
    folder = root / 'oracle'
    raw = (folder / 'cases.jsonl').read_bytes()
    verdicts = json.loads((folder / 'verdicts.json').read_bytes())
    meta = verdicts['meta']
    lock = (folder / 'package-lock.json').read_bytes()
    pin = json.loads((folder / 'package.json').read_bytes())['dependencies']['typescript']
    if (meta['cases_sha256'] != digest(raw)
            or meta['runner_sha256'] != digest((folder / 'run.mjs').read_bytes())
            or meta['package_lock_sha256'] != digest(lock)
            or meta['version'] != pin
            or meta['arguments'] != oracle_args()):
        raise ValueError(f'{folder}: oracle verdicts are stale or use a different pin')
    by_id = {v['id']: v for v in verdicts['results']}
    seen = set()
    for line in raw.split(b'\n'):
        if not line.strip():
            continue
        case = json.loads(line)
        name, dialect = case['id'], case['grammar']
        source = case['source'].encode('utf-8')
        v = by_id[name]
        if (name in seen or dialect not in LANGUAGES or v['grammar'] != dialect
                or v['sha256'] != case['sha256'] or v['sha256'] != digest(source)
                or v['verdict'] not in ('accept', 'syntax')):
            raise ValueError(f'{folder}: invalid oracle record {name}')
        seen.add(name)
        verdict = {'valid': v['verdict'] == 'accept', 'codes': v['codes'], 'origin': 'oracle'}
        yield Case('oracle', name, dialect, source, verdict if lock == compiler_lock else None)
    if len(seen) != len(by_id) or len(seen) != len(verdicts['results']):
        raise ValueError(f'{folder}: oracle cases and verdicts differ')


def oracle_args():
    return ['--noEmit', '--noCheck', '--pretty', 'false', '--target', 'esnext', '--jsx', 'preserve']


def corpus(root):
    # Same header/source extraction as the earlier handoff, including literal NUL and line separators.
    header = re.compile(rb'^(={3,})[^\n]*\n(.*?)\n\1[^\n]*\n', re.M | re.S)
    for file in sorted((root / 'test/corpus').glob('*.txt')):
        data = file.read_bytes().replace(b'\r\n', b'\n')
        matches = list(header.finditer(data))
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(data)
            body = b'\n' + data[match.end():end]
            separator = re.search(rb'\n-{3,}[^\n]*\n', body)
            labels = match[2].decode('utf-8').split('\n')
            selected = {label[10:-1] for label in labels if label.startswith(':language(')}
            if not separator or not selected <= set(LANGUAGES):
                raise ValueError(f'Malformed corpus case {file.name}: {labels[0]}')
            # The separator consumes its preceding newline. Other bytes are part of the fixture.
            for dialect in LANGUAGES:
                if not selected or dialect in selected:
                    yield Case('corpus', f'{file.stem}/{index + 1}/{labels[0]}', dialect,
                               body[1:separator.start()])


def example_inputs(cache, root, example_pins):
    folders = [(root / 'examples', 'examples')]
    for name, _, commit in example_pins:
        folder = example_folder(cache, name, commit) / 'sources'
        if (folder / '.ready').read_text(encoding='ascii') != commit:
            raise ValueError(f'{name}: stale pin')
        folders.append((folder, f'examples/{name}'))
    for folder, prefix in folders:
        for file in sorted(folder.rglob('*')):
            if file.suffix in ('.ts', '.tsx') and file.is_file():
                yield Case('example', f'{prefix}/{file.relative_to(folder).as_posix()}',
                           'tsx' if file.suffix == '.tsx' else 'typescript', file)


def inputs(cache, root, baseline, candidate, example_pins, fixtures):
    compiler_lock = (root / 'oracle/package-lock.json').read_bytes()
    reference = [*corpus(root), *oracle(root, compiler_lock)]
    yield from reference
    reference_keys = {(c.group, c.dialect, c.data) for c in reference}
    added = set()
    for label, revision in [('candidate', candidate), ('baseline', baseline)]:
        if revision == root:
            continue
        seen = reference_keys.copy()
        for case in [*corpus(revision), *oracle(revision, compiler_lock)]:
            key = case.group, case.dialect, case.data
            identity = (*key, case.name)
            if key not in seen and identity not in added:
                yield Case(f'{label}-{case.group}', case.name, case.dialect, case.data, case.verdict)
                added.add(identity)
            seen.add(key)
    yield from example_inputs(cache, root, example_pins)
    for name, source, steps, ranged, tsx_only in fixtures:
        versions = [source]
        for step in steps:
            versions.append(edit_source(versions[-1], step))
        for dialect in ('tsx',) if tsx_only else LANGUAGES:
            for index, data in enumerate(versions):
                yield Case('js-regression', f'{name}#{index}', dialect,
                           data.replace(GAP, b'') if ranged else data)


def known_failures(root):
    return dict(line.split('\t', 1) for line in config_lines(root / 'test/examples/known-failures.txt'))
