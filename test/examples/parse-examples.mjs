// Parses every .ts and .tsx file under examples/ (this repository's examples/*.ts{,x} and the pinned clones listed in
// repos.txt) and compares the files that fail with known-failures.txt exactly. A new failure fails, and so does a
// listed file that now parses: remove it from the list in the same change. The list may only shrink.
// Usage: node test/examples/parse-examples.mjs [extra tree-sitter parse arguments]
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = 'test/examples';
const lines = (file) => readFileSync(join(here, file), 'utf8').split('\n').map((l) => l.trimEnd())
  .filter((l) => l.trim() && !l.startsWith('#'));
const gitFiles = (dir) => execFileSync('git', ['-C', dir, 'ls-files', '-z', '--', '*.ts', '*.tsx'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0').filter(Boolean);

const files = gitFiles('examples').map((f) => `examples/${f}`);
for (const [name] of lines('repos.txt').map((l) => l.trim().split(/\s+/))) {
  files.push(...gitFiles(`examples/${name}`).map((f) => `examples/${name}/${f}`));
}

const known = new Map();
for (const line of lines('known-failures.txt')) {
  const [file, reason] = line.split('\t');
  if (!reason?.trim()) throw new Error(`known-failures.txt: no reason for ${file}`);
  known.set(file, reason.trim());
}

const list = join(mkdtempSync(join(tmpdir(), 'parse-examples-')), 'paths');
writeFileSync(list, files.join('\n'));
const run = spawnSync(process.env.TREE_SITTER ?? 'tree-sitter',
  ['parse', '-q', '-t', '--paths', list, ...process.argv.slice(2)],
  { encoding: 'utf8', maxBuffer: 1 << 30 });
if (run.error) throw run.error;

// Same failure rule as tree-sitter/parse-action: a result line ending in "(KIND [row, col] - [row, col])".
const failed = new Set();
let parsed = 0;
for (const line of run.stdout.split('\n')) {
  if (!line.includes('\tParse:')) continue;
  parsed += 1;
  if (/\((.+) \[(\d+), (\d+)\] - \[(\d+), (\d+)\]\)\s*$/.test(line)) {
    failed.add(line.split('\t')[0].trim().replaceAll('\\', '/'));
  }
}

const problems = [];
if (parsed !== files.length) {
  problems.push(`tree-sitter reported ${parsed} of ${files.length} files (exit ${run.status})\n${run.stderr}`);
}
const added = [...failed].filter((f) => !known.has(f)).sort();
const passing = [...known.keys()].filter((f) => !failed.has(f)).sort();
if (added.length) problems.push(`new failures (fix the grammar or the input; do not list them):\n  ${added.join('\n  ')}`);
if (passing.length) problems.push(`listed files that now parse (remove them from known-failures.txt):\n  ${passing.join('\n  ')}`);

const summary = `Parsed ${parsed} files: ${failed.size} failing, ${known.size} known failures.`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
