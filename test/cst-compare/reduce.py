import math
import re


# Keep CR/CRLF and literal Unicode line separators independent of ordinary spaces.
TOKENS = re.compile(r'\r\n|[\n\r\u2028\u2029]|[^\S\n\r\u2028\u2029]+|\w+|[^\w\s]')


def signature(diff):
    if diff is None:
        return None
    before, after = diff['before'], diff['after']

    def shape(node):
        return None if node is None else {k: v for k, v in node.items() if k not in ('bytes', 'points')}

    ranges = None
    if before is not None and after is not None:
        ranges = tuple((a > b) - (a < b) for a, b in zip(before['bytes'], after['bytes']))
    return shape(before), shape(after), ranges


def ddmin(parts, interesting):
    granularity = 2
    while parts:
        width = math.ceil(len(parts) / granularity)
        start, deleted = 0, False
        while start < len(parts):
            shorter = parts[:start] + parts[start + width:]
            if interesting(''.join(shorter).encode('utf-8')):
                parts = shorter
                deleted = True
            else:
                start += width
        if width == 1 and not deleted:
            break
        granularity = min(max(len(parts), 1), granularity * 2)
    return ''.join(parts).encode('utf-8')


def minimize(source, diff, before_error, after_error, compare, valid, screen, earlier=None, contexts=None):
    expected_signature = signature(diff)

    def still_breaks(trial):
        a, b, witness = compare(trial)
        return a == before_error and b == after_error and signature(witness) == expected_signature

    def reduce(raw, interesting):
        text = raw.decode('utf-8')
        if len(text) > 1024:
            raw = ddmin(text.splitlines(keepends=True), interesting)
        return ddmin(TOKENS.findall(raw.decode('utf-8')), interesting)

    reused = bool(earlier and len(earlier) < len(source) and still_breaks(earlier) and valid(earlier))
    # A local witness usually needs only the affected statement and its parent syntax.
    nodes = [node for node in diff.values() if node is not None]
    start = min(node['bytes'][0] for node in nodes)
    end = max(node['bytes'][1] for node in nodes)
    parent = nodes[0]['parent']
    if reused:
        source = earlier
    elif end - start < 1024 and all(node['parent'] == parent for node in nodes):
        span = source[start:end]
        if parent == 'statement_block':
            seeds = [b'{\n' + span + b'\n}', b'function f(){\n' + span + b'\n}',
                     b'async function f(){\n' + span + b'\n}']
        elif parent == 'variable_declarator':
            seeds = [b'let x=' + span, b'async function f(){let x=' + span + b'}',
                     b'async()=>{let x=' + span + b'}']
        elif parent == 'return_statement':
            seeds = [b'async function f(){return ' + span + b'}']
        elif parent == 'arguments':
            seeds = [b'f(' + span + b')']
        elif parent == 'expression_statement':
            seeds = [span, b'async function f(){' + span + b'}']
        elif parent == 'arrow_function':
            seeds = [b'()=> ' + span]
        elif parent == 'parenthesized_expression':
            seeds = [b'(' + span + b')']
        else:
            seeds = [span]
        for trial in seeds:
            if len(trial) < len(source) and still_breaks(trial) and valid(trial):
                source = trial
                break

    if not reused and contexts and len(source) > 1024:
        for trial in sorted(set(contexts()), key=len):
            if len(trial) < len(source) and still_breaks(trial) and valid(trial):
                source = trial
                break

    checkpoints = {}

    def remember(trial):
        if not still_breaks(trial):
            return False
        key = len(trial).bit_length()
        checkpoints[key] = (checkpoints.get(key, (trial, trial))[0], trial)
        return True

    smaller = reduce(source, remember)
    if valid(smaller):
        quality = 'deletion-minimized'
    else:
        trials = sorted({trial for pair in checkpoints.values() for trial in pair}, key=len)
        seed = next((trial for trial in trials if valid(trial)), source)
        smaller = reduce(seed, lambda trial: still_breaks(trial) and screen(trial))
        if not valid(smaller):
            smaller = reduce(seed, lambda trial: still_breaks(trial) and valid(trial))
        quality = 'deletion-minimized-with-tsc'
    a, b, witness = compare(smaller)
    if (a, b) != (before_error, after_error) or signature(witness) != expected_signature or not valid(smaller):
        raise ValueError('Reduction changed the qualifying CST difference')
    return {'source': smaller.decode('utf-8'), 'bytes': len(smaller), 'quality': quality,
            'first_difference': witness, 'reused_earlier_seed': reused}
