import argparse
import ctypes as c
import json
import os
import re
import sys
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing

sys.dont_write_bytecode = True

from contract import compare_contract, node_types, self_test
from inputs import EXT, inputs, known_failures
from native import LANGUAGES, Edit, Runtime, build_grammar, build_runtime, digest, generate, pinned_cli, point
from prepare import BUILD, pins, prepare, revision, snapshot
from reduce import minimize
from regressions import MANIFEST, edit_source, included_ranges, regression_inputs
from syntax import Tsc


def kind(before_error, after_error, valid, same):
    if same:
        return 'same'
    if not before_error and valid:
        return 'valid-baseline-clean'
    if before_error and not after_error:
        return 'error-to-ok'
    if before_error and after_error:
        return 'error-to-error'
    if after_error:
        return 'invalid-ok-to-error'
    return 'invalid-ok-to-ok'


def check_incremental(rt, parser, independent, source, steps, ranged=False):
    if ranged:
        rt.ranges(parser, source, included_ranges(source))
    old = rt.parse(parser, None, source, len(source))
    if not old:
        raise RuntimeError('Initial parse failed')
    try:
        for index, step in enumerate(steps, 1):
            start, end, text = step
            updated = edit_source(source, step)
            edit = Edit(start, end, start + len(text), point(source, start), point(source, end),
                        point(updated, start + len(text)))
            rt.edit(old, c.byref(edit))
            reuse = old
            if ranged:
                ranges = included_ranges(updated)
                # A changed range set can extend the previous lexer view. Reset after a range change.
                if ranges != included_ranges(source):
                    reuse = None
                rt.ranges(parser, updated, ranges)
                rt.ranges(independent, updated, ranges)
            current = rt.parse(parser, reuse, updated, len(updated))
            if not current:
                raise RuntimeError('Edited parse failed')
            rt.delete_tree(old)
            old = current
            with rt.tree(independent, updated) as fresh:
                difference = rt.difference(fresh, current)
                row = {'step': index, 'mode': 'reuse' if reuse else 'fresh-after-range-change',
                       'edit': [start, end, text.decode()], 'sha256': digest(updated),
                       'fresh_error_or_missing': rt.has_error(rt.root(fresh)),
                       'updated_error_or_missing': rt.has_error(rt.root(current)),
                       'equal': difference is None, 'first_difference': difference}
                if ranged:
                    row['ranges'] = ranges
                yield row, current
            source = updated
    finally:
        rt.delete_tree(old)
        if ranged:
            rt.ranges(parser, b'', [])
            rt.ranges(independent, b'', [])


def incremental(rt, baseline, candidate, dialect, cases, fixtures, out):
    edits = []
    for name, source, steps, ranged, tsx_only in fixtures:
        if dialect == 'typescript' and tsx_only:
            continue
        if steps:
            edits.append((name, source, steps, ranged))
    # Prepend an edit before the existing scanner trigger and roll it back.
    seen = set()
    for case in cases:
        if case.group != 'oracle' or not re.match(r'n[257]/', case.name):
            continue
        source = case.source()
        if source not in seen:
            seen.add(source)
            edits.append((case.name, source, [(0, 0, b' '), (0, 1, b'')], False))
    count = Counter()
    with rt.parser(baseline, dialect) as a, rt.parser(baseline, dialect) as fresh_a, \
            rt.parser(candidate, dialect) as b, rt.parser(candidate, dialect) as fresh_b:
        for name, source, steps, ranges in edits:
            with closing(check_incremental(rt, a, fresh_a, source, steps, ranges)) as before, \
                    closing(check_incremental(rt, b, fresh_b, source, steps, ranges)) as after:
                for (x, old_tree), (y, new_tree) in zip(before, after, strict=True):
                    difference = rt.difference(old_tree, new_tree)
                    write_row(out, {'id': name, 'dialect': dialect, 'original_sha256': digest(source),
                                    'baseline': x, 'candidate': y, 'cross_version_difference': difference})
                    count['steps'] += 1
                    count['fresh_after_range_change'] += x['mode'] == 'fresh-after-range-change'
                    count['baseline_divergences'] += not x['equal']
                    count['candidate_divergences'] += not y['equal']
                    count['new_divergences'] += x['equal'] and not y['equal']
                    count['resolved_divergences'] += not x['equal'] and y['equal']
                    count['changed_checks'] += x != y
                    count['cross_version_differences'] += difference is not None
    return dict(count)


def write_row(out, row):
    out.write(json.dumps(row, ensure_ascii=True, separators=(',', ':')) + '\n')


def reduce_case(rt, baseline, candidate, dialect, source, row, verdicts, tsc, validity_cache, earlier):
    with tempfile.TemporaryDirectory(dir=tsc.cache / 'tmp', prefix='repros-') as folder, \
            rt.parser(baseline, dialect) as a, rt.parser(candidate, dialect) as b:
        def compare(trial):
            timeout = 0 if trial == source else 100_000
            rt.set_timeout(a, timeout)
            rt.set_timeout(b, timeout)
            with rt.tree(a, trial, allow_timeout=bool(timeout)) as before, \
                    rt.tree(b, trial, allow_timeout=bool(timeout)) as after:
                if not before or not after:
                    return None, None, None
                return (rt.has_error(rt.root(before)), rt.has_error(rt.root(after)),
                        rt.difference(before, after))

        def contexts():
            rt.set_timeout(a, 0)
            return list(rt.contexts(a, source, row['first_difference']))

        def valid(source, screening=False):
            key = dialect, digest(source)
            if key in verdicts:
                return verdicts[key]['valid']
            check_key = (*key, screening)
            if check_key not in validity_cache:
                validity_cache[check_key] = tsc.check(dialect, source, Path(folder), screening=screening)['valid']
            return validity_cache[check_key]

        return minimize(source, row['first_difference'], row['baseline_error_or_missing'],
                        row['candidate_error_or_missing'], compare, valid,
                        lambda trial: valid(trial, screening=True), earlier, contexts)


def earlier_reproductions(dialect):
    seeds = {}
    for path in sorted((BUILD / 'results').glob(f'*/{dialect}-major.jsonl')):
        if not (path.parent / 'summary.json').is_file():
            continue
        for line in path.read_bytes().split(b'\n')[:-1]:
            row = json.loads(line)
            source = row['reproduction']['source'].encode('utf-8')
            sha = row['sha256']
            if sha not in seeds or len(source) < len(seeds[sha]):
                seeds[sha] = source
    return seeds


def compare_dialect(rt, baseline, candidate, dialect, cases, verdicts, tsc, records, major, smoke):
    counts, groups = Counter(), {}
    examples_a, examples_b = set(), set()
    reductions, major_rows, major_count = {}, {}, 0
    validity_cache = {}
    seeds = earlier_reproductions(dialect)
    with ThreadPoolExecutor(max_workers=6) as workers, \
            rt.parser(baseline, dialect) as a, rt.parser(candidate, dialect) as b:
        for case in cases:
            source = case.source()
            sha = digest(source)
            verdict = case.verdict or verdicts[dialect, sha]
            with rt.tree(a, source) as before_tree, rt.tree(b, source) as after_tree:
                before = rt.has_error(rt.root(before_tree))
                after = rt.has_error(rt.root(after_tree))
                difference = rt.difference(before_tree, after_tree)
            category = kind(before, after, verdict['valid'], difference is None)
            counts[category] += 1
            groups.setdefault(case.group, Counter())[category] += 1
            if case.group == 'example':
                if before:
                    examples_a.add(case.name)
                if after:
                    examples_b.add(case.name)
            row = {'id': case.name, 'group': case.group, 'dialect': dialect, 'sha256': sha,
                   'bytes': len(source), 'baseline_error_or_missing': before,
                   'candidate_error_or_missing': after, 'tsc': verdict,
                   'equal': difference is None, 'classification': category}
            if difference:
                row['first_difference'] = difference
            write_row(records, row)
            if category == 'valid-baseline-clean':
                major_count += 1
                if smoke and major_rows:
                    continue
                if sha not in reductions:
                    reductions[sha] = workers.submit(reduce_case, rt, baseline, candidate, dialect,
                                                      source, row, verdicts, tsc, validity_cache, seeds.get(sha))
                major_rows.setdefault(reductions[sha], []).append(row)
        records.flush()
        print(f'{dialect}: {len(cases)} CST pairs, {major_count} MAJOR records '
              f'({len(reductions)} sources to reduce)', flush=True)
        verified = 0
        for future in as_completed(major_rows):
            reproduction = future.result()
            for row in major_rows[future]:
                write_row(major, dict(row, reproduction=reproduction))
                verified += 1
                if verified % 25 == 0:
                    major.flush()
                    print(f'{dialect}: {verified}/{major_count} MAJOR reproductions verified', flush=True)
    return {'counts': dict(counts), 'groups': groups, 'verified_reproductions': verified}, examples_a, examples_b


def example_gate(observed, listed, dialect):
    listed = {name for name in listed if name.endswith('.' + EXT[dialect])}
    return {'observed_failures': sorted(observed), 'listed_failures': sorted(listed),
            'new_failures': sorted(observed - listed), 'now_passing': sorted(listed - observed)}


def run(args, cache, dest):
    self_test()
    assert kind(False, False, True, False) == 'valid-baseline-clean'
    assert kind(False, True, False, False) == 'invalid-ok-to-error'
    assert kind(True, True, True, False) == 'error-to-error'
    assert kind(True, False, True, False) == 'error-to-ok'
    refs = {'baseline': args.baseline, 'candidate': args.candidate,
            'inputs': args.inputs_ref or args.baseline}
    shas = {label: revision(ref) for label, ref in refs.items()}
    roots = {label: snapshot(cache, sha) for label, sha in shas.items()}
    base, candidate, input_root = (roots[label] for label in refs)
    cli = {'baseline': pinned_cli(base, args.base_cli or args.cli),
           'candidate': pinned_cli(candidate, args.cli)}
    example_pins = list(pins(input_root))
    runtime_src, runtime_version, runtime_sum = prepare(cache, input_root, example_pins)
    fixtures = regression_inputs(cache)
    cases = list(inputs(cache, input_root, base, candidate, example_pins, fixtures))
    tsc = Tsc(cache, input_root)
    verdicts = tsc.verdicts(cases)
    rt = Runtime(build_runtime(cache, runtime_src, runtime_sum))
    baseline_known = known_failures(base)
    candidate_known = known_failures(candidate)
    result = {**shas, 'refs': refs, 'cli': {label: version for label, (_, version) in cli.items()},
              'runtime': runtime_version, 'runtime_checksum': runtime_sum,
              'tsc': tsc.version, 'fixture_manifest_sha256': digest(MANIFEST.read_bytes()),
              'smoke': args.smoke, 'example_pins': {name: sha for name, _, sha in example_pins},
              'dialects': {}}
    for dialect in LANGUAGES:
        print(f'Comparing {dialect}', flush=True)
        sample = [case for case in cases if case.dialect == dialect]
        generation = {label: generate(cache, roots[label], dialect, path)
                      for label, (path, _) in cli.items()}
        a, b = (build_grammar(cache, root, dialect) for root in (base, candidate))
        rt.self_test(a, dialect)
        rt.self_test(b, dialect)
        with (dest / f'{dialect}.jsonl').open('w', encoding='utf-8', newline='\n') as records, \
                (dest / f'{dialect}-major.jsonl').open('w', encoding='utf-8', newline='\n') as major, \
                (dest / f'{dialect}-incremental.jsonl').open('w', encoding='utf-8', newline='\n') as edits:
            summary, errors_a, errors_b = compare_dialect(rt, a, b, dialect, sample, verdicts, tsc, records, major, args.smoke)
            summary['incremental'] = incremental(rt, a, b, dialect, sample, fixtures, edits)
        contract = compare_contract(node_types(base, dialect), node_types(candidate, dialect))
        (dest / f'{dialect}-contract.json').write_text(json.dumps(contract, indent=2) + '\n', encoding='utf-8')
        summary.update(generation=generation, contract=dict(Counter(row['level'] for row in contract)),
                       examples={'baseline': example_gate(errors_a, baseline_known, dialect),
                                 'candidate': example_gate(errors_b, candidate_known, dialect),
                                 'relative_to_baseline_list': example_gate(errors_b, baseline_known, dialect)})
        result['dialects'][dialect] = summary
        print(dialect, summary['counts'], summary['contract'], summary['incremental'], flush=True)

    dialects = result['dialects'].values()
    counts = sum((Counter(summary['counts']) for summary in dialects), Counter())
    contract = sum((Counter(summary['contract']) for summary in dialects), Counter())
    result['counts'] = dict(counts)
    result['contract'] = dict(contract)
    if counts['valid-baseline-clean'] or contract['breaking']:
        result['semver'] = 'MAJOR'
    elif counts['invalid-ok-to-ok']:
        result['semver'] = 'REVIEW'
    elif contract['addition'] or any(counts[name] for name in ('error-to-ok', 'error-to-error', 'invalid-ok-to-error')):
        result['semver'] = 'MINOR'
    else:
        result['semver'] = 'IDENTICAL'
    (dest / 'summary.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(result['semver'], counts, flush=True)
    if args.expect_identical:
        if result['semver'] != 'IDENTICAL':
            raise SystemExit(f"Expected IDENTICAL, got {result['semver']}")
        for dialect, summary in result['dialects'].items():
            edits = summary['incremental']
            if edits['changed_checks'] or edits['cross_version_differences']:
                raise SystemExit(f'{dialect}: incremental comparisons changed')
            for side, generation in summary['generation'].items():
                if any(generation[key] for key in ('generated_drift', 'forbidden_pragmas',
                                                   'regenerated_forbidden_pragmas')):
                    raise SystemExit(f'{dialect}: {side} generation check failed')
            for side in ('baseline', 'candidate'):
                gate = summary['examples'][side]
                if gate['new_failures'] or gate['now_passing']:
                    raise SystemExit(f'{dialect}: {side} example failures differ from its list')


def main():
    parser = argparse.ArgumentParser(description='Compare full TypeScript and TSX CSTs at two Git revisions.')
    parser.add_argument('baseline', help='baseline Git ref')
    parser.add_argument('candidate', help='candidate Git ref')
    parser.add_argument('run_name', help='new directory under build/cst-compare/results')
    parser.add_argument('--inputs-ref', help='fixed inputs, example pins and oracle toolchain (default: baseline)')
    parser.add_argument('--cli', default='tree-sitter', help='candidate CLI executable (default: tree-sitter on PATH)')
    parser.add_argument('--base-cli', help='baseline CLI executable when its pin differs (default: use --cli)')
    parser.add_argument('--cache-name', default='default', help='cache under build/cst-compare/cache (use a new name for an empty cache)')
    parser.add_argument('--expect-identical', action='store_true')
    parser.add_argument('--smoke', action='store_true', help='verify just one MAJOR reproduction per dialect')
    args = parser.parse_args()
    if sys.platform != 'win32':
        parser.error('the CST comparison runner requires Windows')
    for label, name in [('run_name', args.run_name), ('--cache-name', args.cache_name)]:
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]*', name) or name.endswith('.'):
            parser.error(f'{label} must be a single safe directory name')

    import msvcrt

    cache = BUILD / 'cache' / args.cache_name
    scratch = cache / 'tmp'
    scratch.mkdir(parents=True, exist_ok=True)
    os.environ.update(TEMP=str(scratch), TMP=str(scratch), TMPDIR=str(scratch))
    with (cache / '.lock').open('a+b') as lock:
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            parser.error(f'cache is in use: {cache}')
        dest = BUILD / 'results' / args.run_name
        try:
            dest.mkdir(parents=True)
        except FileExistsError:
            parser.error(f'output already exists: {dest}')
        run(args, cache, dest)


if __name__ == '__main__':
    main()
