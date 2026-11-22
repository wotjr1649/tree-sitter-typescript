import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compare, snapshot } from './generate.mjs';

const types = [
  { type: 'expression', named: true, subtypes: [{ type: 'identifier', named: true }, { type: 'call', named: true }] },
  {
    type: 'call',
    named: true,
    fields: {
      function: { multiple: false, required: true, types: [{ type: 'identifier', named: true }] },
      arguments: { multiple: false, required: true, types: [{ type: 'args', named: true }, { type: '(', named: false }] },
    },
    children: { multiple: true, required: false, types: [{ type: 'this', named: false }] },
  },
  { type: 'identifier', named: true },
  { type: 'this', named: true },
  { type: 'this', named: false },
];

test('snapshot is sorted and tells named from anonymous kinds', () => {
  const s = snapshot(types);
  assert.deepEqual(s, [...s].sort());
  assert.ok(s.includes('kind\tthis') && s.includes('kind\t"this"'));
  assert.ok(s.includes('field\tcall\targuments\t"("'));
  assert.ok(s.includes('subtype\texpression\tcall'));
  assert.ok(s.includes('child\tcall\t"this"'));
  assert.ok(s.includes('multiple\tcall\tchildren'));
  assert.ok(s.includes('required\tcall\targuments'));
  assert.deepEqual(snapshot([...types].reverse()), s);
});

test('identical snapshots compare clean', () => {
  assert.deepEqual(compare(snapshot(types), snapshot(types)), { failures: [], notes: [] });
});

test('a renamed field fails, an added kind is only a note', () => {
  const next = structuredClone(types);
  next[1].fields.callee = next[1].fields.function;
  delete next[1].fields.function;
  next.push({ type: 'spread', named: true });
  const { failures, notes } = compare(snapshot(types), snapshot(next));
  assert.deepEqual(failures, ['removed field call.function']);
  assert.ok(notes.includes('added kind spread'));
  assert.ok(notes.includes('added field call callee identifier'));
});

test('a removed field type, kind, anonymous kind and subtype all fail', () => {
  const next = structuredClone(types);
  next[1].fields.arguments.types.pop();
  next[0].subtypes.pop();
  next.splice(4, 1);
  next.splice(2, 1);
  const { failures, notes } = compare(snapshot(types), snapshot(next));
  assert.deepEqual(failures.sort(), [
    'removed kind "this"',
    'removed kind identifier',
    'removed subtype call of expression',
    'removed type "(" of field call.arguments',
  ]);
  assert.deepEqual(notes, []);
});

test('a removed child type fails', () => {
  const next = structuredClone(types);
  next[1].children.types.pop();
  assert.deepEqual(compare(snapshot(types), snapshot(next)), {
    failures: ['removed child type "this" of call'],
    notes: [],
  });
});

test('an added child type is only a note', () => {
  const next = structuredClone(types);
  next[1].children.types.push({ type: 'identifier', named: true });
  assert.deepEqual(compare(snapshot(types), snapshot(next)), {
    failures: [],
    notes: ['added child call identifier'],
  });
});

for (const target of ['arguments', 'children']) {
  for (const [flag, value, failure] of [
    ['multiple', false, 'removed multiple'],
    ['multiple', true, null],
    ['required', false, null],
    ['required', true, 'added required'],
  ]) {
    test(`${target}: ${flag} becomes ${value}`, () => {
      const before = structuredClone(types);
      const info = target === 'children' ? before[1].children : before[1].fields[target];
      info[flag] = !value;
      const previous = snapshot(before);
      info[flag] = value;
      assert.deepEqual(compare(previous, snapshot(before)), {
        failures: failure ? [`${failure} call ${target}`] : [],
        notes: failure ? [] : [`${value ? 'added' : 'removed'} ${flag} call ${target}`],
      });
    });
  }
}

test('new required fields and children are only notes', () => {
  const before = structuredClone(types);
  delete before[1].children;
  const after = structuredClone(types);
  after[1].children.required = true;
  after[1].fields.extra = after[1].fields.function;
  assert.deepEqual(compare(snapshot(before), snapshot(after)), {
    failures: [],
    notes: [
      'added child call "this"',
      'added field call extra identifier',
      'added multiple call children',
      'added required call children',
      'added required call extra',
    ],
  });
});

test('a field named children has its own flags', () => {
  const before = structuredClone(types);
  before[1].children.required = true;
  before[1].fields.children = { multiple: false, required: false, types: [{ type: 'identifier', named: true }] };
  const after = structuredClone(before);
  after[1].fields.children.multiple = true;
  after[1].fields.children.required = true;
  assert.deepEqual(compare(snapshot(before), snapshot(after)), {
    failures: ['added required call "children"'],
    notes: ['added multiple call "children"'],
  });
});

test('both dialects are checked against release JSON even after snapshot regeneration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'node-kinds-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshots = join(root, 'test/node-kinds');
  const baseline = join(root, 'baseline');
  mkdirSync(snapshots, { recursive: true });
  mkdirSync(baseline);
  const script = join(snapshots, 'generate.mjs');
  copyFileSync(new URL('./generate.mjs', import.meta.url), script);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const grammars = ['typescript', 'tsx'];
  const current = (grammar) => join(root, grammar, 'src/node-types.json');
  const committed = (grammar) => join(snapshots, `${grammar}.txt`);
  for (const grammar of grammars) {
    mkdirSync(join(root, grammar, 'src'), { recursive: true });
    writeFileSync(current(grammar), JSON.stringify(types));
    writeFileSync(join(baseline, `${grammar}.json`), JSON.stringify(types));
  }
  assert.equal(run().status, 0);
  assert.equal(run('--compare-baseline', baseline).status, 0);

  for (const grammar of grammars) {
    const updated = structuredClone(types);
    delete updated[1].children;
    writeFileSync(current(grammar), JSON.stringify(updated));
    const snapshotText = `${snapshot(updated).join('\n')}\n`;
    assert.notEqual(readFileSync(committed(grammar), 'utf8'), snapshotText);
    assert.equal(run().status, 0);
    assert.equal(readFileSync(committed(grammar), 'utf8'), snapshotText);
    const result = run('--compare-baseline', baseline);
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`::error::${grammar}: removed child type "this" of call`));
    assert.match(result.stdout, new RegExp(`${grammars.find((other) => other !== grammar)}: 0 breaking change`));
    assert.equal(readFileSync(committed(grammar), 'utf8'), snapshotText);
    writeFileSync(current(grammar), JSON.stringify(types));
  }

  const tsxBaseline = join(baseline, 'tsx.json');
  for (const corrupt of [false, true]) {
    if (corrupt) writeFileSync(tsxBaseline, '{');
    else rmSync(tsxBaseline);
    const result = run('--compare-baseline', baseline);
    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes(`tsx: ${tsxBaseline}:`));
  }
});
