import json


def kinds(entries):
    return {(entry['type'], entry['named']): entry for entry in entries}


def describe(key):
    kind, named = key
    return {'type': kind, 'named': named}


def compare_contract(before, after):
    old, new = kinds(before), kinds(after)
    changes = []

    def add(level, part, change, **details):
        changes.append({'level': level, **part, 'change': change, **details})

    def compare_types(a, b, part):
        removed, added = kinds(a).keys() - kinds(b).keys(), kinds(b).keys() - kinds(a).keys()
        for key in sorted(removed):
            add('breaking', part, 'removed_type', type=describe(key))
        for key in sorted(added):
            add('addition', part, 'added_type', type=describe(key))

    def compare_slot(a, b, part):
        if a is None:
            add('breaking' if b['required'] else 'addition', part, 'added_slot', after=b)
        elif b is None:
            add('breaking', part, 'removed_slot', before=a)
        else:
            for flag, breaking_value in (('multiple', False), ('required', True)):
                if a[flag] != b[flag]:
                    level = 'breaking' if b[flag] == breaking_value else 'addition'
                    add(level, part, f'{flag}_changed', before=a[flag], after=b[flag])
            compare_types(a['types'], b['types'], part)

    for key in sorted(old.keys() | new.keys()):
        part = {'node': describe(key), 'part': 'kind'}
        if key not in old or key not in new:
            add('breaking' if key in old else 'addition', part,
                'removed_kind' if key in old else 'added_kind')
            continue
        a, b = old[key], new[key]
        fields_a, fields_b = a.get('fields', {}), b.get('fields', {})
        for field in sorted(fields_a.keys() | fields_b.keys()):
            compare_slot(fields_a.get(field), fields_b.get(field), dict(part, part='field', field=field))
        if 'children' in a or 'children' in b:
            compare_slot(a.get('children'), b.get('children'), dict(part, part='children'))
        if ('subtypes' in a) != ('subtypes' in b):
            add('breaking' if 'subtypes' in a else 'addition', dict(part, part='supertype'),
                'removed_supertype' if 'subtypes' in a else 'added_supertype')
        compare_types(a.get('subtypes', []), b.get('subtypes', []), dict(part, part='subtypes'))
    return changes


def node_types(root, dialect):
    return json.loads((root / dialect / 'src/node-types.json').read_bytes())


def self_test():
    identifier = {'type': 'identifier', 'named': True}
    number = {'type': 'number', 'named': True}
    old = [{'type': 'x', 'named': True, 'fields': {
        'value': {'multiple': True, 'required': False, 'types': [identifier, number]}}},
        {'type': 'term', 'named': True, 'subtypes': [identifier, number]}, identifier, number]
    new = [{'type': 'x', 'named': True, 'fields': {
        'value': {'multiple': False, 'required': True, 'types': [identifier]},
        'tag': {'multiple': False, 'required': False, 'types': [identifier]}}},
        {'type': 'term', 'named': True, 'subtypes': [identifier]}, identifier]
    rows = compare_contract(old, new)
    assert {(row['level'], row['part'], row['change']) for row in rows} == {
        ('breaking', 'kind', 'removed_kind'), ('addition', 'field', 'added_slot'),
        ('breaking', 'field', 'removed_type'), ('breaking', 'subtypes', 'removed_type'),
        ('breaking', 'field', 'multiple_changed'), ('breaking', 'field', 'required_changed')}
    assert not compare_contract(old, old)
