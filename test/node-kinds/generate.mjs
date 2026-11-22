// The two committed snapshots record the public node-types contract, one tab-separated line per fact.
// Run without arguments to regenerate them, or pass --compare-baseline DIR with typescript.json and tsx.json.
// Baseline checks read the release JSON directly, independently of the committed candidate snapshots.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const name = (t) => (t.named ? t.type : JSON.stringify(t.type));

function addFlags(lines, parent, target, info) {
  if (info.multiple) lines.add(`multiple\t${parent}\t${target}`);
  if (info.required) lines.add(`required\t${parent}\t${target}`);
}

export function snapshot(nodeTypes) {
  const lines = new Set();
  for (const n of nodeTypes) {
    const parent = name(n);
    lines.add(`kind\t${parent}`);
    for (const [field, info] of Object.entries(n.fields ?? {})) {
      for (const t of info.types) lines.add(`field\t${parent}\t${field}\t${name(t)}`);
      addFlags(lines, parent, field === "children" ? '"children"' : field, info);
    }
    if (n.children) {
      for (const t of n.children.types) lines.add(`child\t${parent}\t${name(t)}`);
      addFlags(lines, parent, "children", n.children);
    }
    for (const t of n.subtypes ?? []) lines.add(`subtype\t${parent}\t${name(t)}`);
  }
  return [...lines].sort();
}

// Compares snapshot lines; `failures` are the breaking changes, `notes` everything else that changed.
export function compare(before, after) {
  const now = new Set(after);
  const fields = new Set(after.filter((l) => l.startsWith("field\t")).map((l) => l.split("\t").slice(0, 3).join("\t")));
  const failures = [];
  const notes = [];
  for (const l of before) {
    if (now.has(l)) continue;
    const [cat, a, b, c] = l.split("\t");
    if (cat === "kind") failures.push(`removed kind ${a}`);
    else if (cat === "subtype") failures.push(`removed subtype ${b} of ${a}`);
    else if (cat === "child") failures.push(`removed child type ${b} of ${a}`);
    else if (cat === "multiple") failures.push(`removed multiple ${a} ${b}`);
    else if (cat === "required") notes.push(`removed required ${a} ${b}`);
    else if (fields.has(`field\t${a}\t${b}`)) failures.push(`removed type ${c} of field ${a}.${b}`);
    else if (!failures.includes(`removed field ${a}.${b}`)) failures.push(`removed field ${a}.${b}`);
  }
  const old = new Set(before);
  for (const l of after) {
    if (old.has(l)) continue;
    const message = `added ${l.replaceAll("\t", " ")}`;
    const [cat, parent, target] = l.split("\t");
    if (cat === "required") {
      const field = target === '"children"' ? "children" : target;
      const prefix = target === "children" ? `child\t${parent}\t` : `field\t${parent}\t${field}\t`;
      if (before.some((line) => line.startsWith(prefix))) {
        failures.push(message);
        continue;
      }
    }
    notes.push(message);
  }
  return { failures, notes };
}

function readSnapshot(path) {
  try {
    return snapshot(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

function main(args) {
  if (args.length && (args.length !== 2 || args[0] !== "--compare-baseline")) {
    console.error("Usage: node test/node-kinds/generate.mjs [--compare-baseline DIR]");
    return 2;
  }
  const baselineDir = args[1];
  const root = fileURLToPath(new URL("../../", import.meta.url));
  let status = 0;
  for (const grammar of ["typescript", "tsx"]) {
    try {
      const current = readSnapshot(join(root, grammar, "src/node-types.json"));
      if (baselineDir === undefined) {
        writeFileSync(new URL(`${grammar}.txt`, import.meta.url), `${current.join("\n")}\n`);
        continue;
      }
      const baseline = readSnapshot(join(baselineDir, `${grammar}.json`));
      const { failures, notes } = compare(baseline, current);
      for (const note of notes) console.log(`::notice::${grammar}: ${note}`);
      for (const failure of failures) console.log(`::error::${grammar}: ${failure}`);
      console.log(`${grammar}: ${failures.length} breaking change(s), ${notes.length} other change(s)`);
      if (failures.length) status = Math.max(status, 1);
    } catch (error) {
      console.error(`${grammar}: ${error.message}`);
      status = 2;
    }
  }
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
