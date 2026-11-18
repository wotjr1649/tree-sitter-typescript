// Verdict runner: reads oracle/cases.jsonl, asks the pinned `tsc` about every case and writes oracle/verdicts.json.
// See oracle/README.md. Exit codes: 0 done; 1 --self-test found a result that differs; 2 inconsistent inputs or an
// inconsistent tsc run (nothing written).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const fail = (msg) => {
  console.error(`run.mjs: ${msg}`);
  process.exit(2);
};

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i < 0 ? dflt : (args[i + 1] ?? fail(`${name} needs a value`));
};
const casesPath = flag("--cases", join(here, "cases.jsonl"));
const outPath = flag("--out", join(here, "verdicts.json"));
const lockPath = join(here, "package-lock.json");

// The oracle: tsc 7.0.2 as a syntax checker. --noCheck drops every checker diagnostic (TS1274 for `function f<in T>() {}`,
// TS1243 for `readonly accessor x` ...) on purpose; what is left is the parser's.
const TOOL = {
  package: "typescript",
  version: "7.0.2",
  integrity: "sha512-8FYau96o3NKOhbjKi/qNvG/W5jhzxkbdm5sj9AbZ/5T5sWqn3hJgLfGx27sRKZWTvyzCP8dLRBTf5tBTSRVUNA==",
};
const TSC_ARGS = ["--noEmit", "--noCheck", "--pretty", "false", "--target", "esnext", "--jsx", "preserve"];
const KEYS = ["id", "sha256", "source", "grammar", "expect", "errorAt", "reason"];
const EXT = { typescript: "ts", tsx: "tsx" };

// ---- cases ---------------------------------------------------------------------------------------------------------
const casesBytes = readFileSync(casesPath);
const cases = casesBytes
  .toString("utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l, n) => {
    let c;
    try {
      c = JSON.parse(l);
    } catch (e) {
      fail(`${basename(casesPath)}:${n + 1}: ${e.message}`);
    }
    for (const k of Object.keys(c)) if (!KEYS.includes(k)) fail(`${basename(casesPath)}:${n + 1}: unknown field ${k}`);
    return c;
  });

if (args.includes("--rehash")) {
  // Fill in or fix `sha256` and write the file in the canonical form (one record per line, fixed key order).
  const out = cases.map((c) => {
    c.sha256 = sha256(Buffer.from(c.source, "utf8"));
    return JSON.stringify(Object.fromEntries(KEYS.filter((k) => k in c).map((k) => [k, c[k]])));
  });
  writeFileSync(casesPath, out.join("\n") + "\n");
  console.log(`rehashed ${out.length} cases`);
  process.exit(0);
}

// ---- one tsc run -----------------------------------------------------------------------------------------------------
// tsc counts lines at \n, \r\n, \r, U+2028 and U+2029 and columns in UTF-16 code units (1-based both); the verdict
// file records UTF-8 byte offsets, the tree-sitter unit. Returns the offset, or null when (line, col) is not a position.
function byteOffset(src, line, col) {
  let at = 0;
  for (let l = 1; l < line; l++) {
    const m = /\r\n|[\n\r\u2028\u2029]/.exec(src.slice(at));
    if (!m) return null;
    at += m.index + m[0].length;
  }
  const utf16 = at + col - 1;
  if (col < 1 || utf16 > src.length) return null;
  const unit = src.charCodeAt(utf16);
  if (utf16 > 0 && unit >= 0xdc00 && unit <= 0xdfff && (src.charCodeAt(utf16 - 1) & 0xfc00) === 0xd800) return null; // inside a surrogate pair
  return Buffer.byteLength(src.slice(0, utf16), "utf8");
}

const TSC_JS = join(here, "node_modules", "typescript", "bin", "tsc");
const DIAG = /^case\.tsx?\((\d+),(\d+)\): error TS(\d+): /;

// Runs tsc on one source and returns { verdict, codes, at }. Anything that does not fit (spawn failure, stderr, a line
// that is no diagnostic of the case file, an exit status that disagrees with the output) is an inconsistent run.
function tsc(source, grammar, extraArgs = TSC_ARGS) {
  const dir = mkdtempSync(join(tmpdir(), "oracle-tsc-"));
  const file = `case.${EXT[grammar]}`;
  try {
    writeFileSync(join(dir, file), Buffer.from(source, "utf8"));
    // Fresh directory, no tsconfig; node + tsc.js instead of the .bin shim so that Windows and Linux run the same thing.
    const r = spawnSync(process.execPath, [TSC_JS, ...extraArgs, file], { cwd: dir, encoding: "utf8", timeout: 120000 });
    if (r.error || r.signal) fail(`tsc did not finish (${r.error?.message ?? r.signal})`);
    if (r.stderr !== "") fail(`tsc wrote to stderr: ${r.stderr.trim()}`);
    const codes = [];
    let at = null;
    for (const line of r.stdout.split(/\r?\n/)) {
      if (line === "") continue;
      if (/^\s/.test(line) && codes.length > 0) continue; // continuation of a chained message
      const m = DIAG.exec(line);
      if (!m) fail(`${file}: diagnostic not attributable to the case file or unparseable: ${JSON.stringify(line)}`);
      codes.push(Number(m[3]));
      if (at === null) {
        at = byteOffset(source, Number(m[1]), Number(m[2]));
        if (at === null) fail(`${file}: position ${m[1]},${m[2]} is outside the source`);
      }
    }
    if ((codes.length === 0) !== (r.status === 0) || r.status > 2) fail(`${file}: exit status ${r.status} does not fit ${codes.length} diagnostics`);
    return { verdict: codes.length ? "syntax" : "accept", codes, at };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- tool: installed version must equal the pin and the lockfile -------------------------------------------------------
const lockBytes = readFileSync(lockPath);
const lock = JSON.parse(lockBytes).packages;
const platformPkg = `@typescript/typescript-${process.platform}-${process.arch}`;
const installed = (pkg) => JSON.parse(readFileSync(join(here, "node_modules", pkg, "package.json"), "utf8")).version;
for (const [pkg, version] of [[TOOL.package, installed(TOOL.package)], [platformPkg, installed(platformPkg)]]) {
  if (version !== TOOL.version || lock[`node_modules/${pkg}`]?.version !== TOOL.version) {
    fail(`${pkg}: installed ${version}, lock ${lock[`node_modules/${pkg}`]?.version}, pin ${TOOL.version}`);
  }
}
const entry = lock[`node_modules/${TOOL.package}`];
if (entry.integrity !== TOOL.integrity || lock[""].dependencies?.[TOOL.package] !== TOOL.version) {
  fail(`${TOOL.package}: lock integrity ${entry.integrity} / package.json pin differ from ${TOOL.version} ${TOOL.integrity}`);
}

// ---- self-test -------------------------------------------------------------------------------------------------------
// Proves the three kinds of answer the owner asked for, and the UTF-16 -> UTF-8 position conversion.
if (args.includes("--self-test")) {
  const noCheckless = TSC_ARGS.filter((a) => a !== "--noCheck");
  const wrong = [];
  const want = (name, got, exp) => {
    const ok = JSON.stringify(got) === JSON.stringify(exp);
    console.log(`${ok ? "ok  " : "DIFF"} ${name}: ${JSON.stringify(got)}`);
    if (!ok) wrong.push(name);
  };
  const pick = (r) => ({ verdict: r.verdict, codes: r.codes, at: r.at });
  want("accepted", pick(tsc("const x: number = 1;\n", "typescript")), { verdict: "accept", codes: [], at: null });
  want("rejected", pick(tsc("let x: number = ;\n", "typescript")), { verdict: "syntax", codes: [1109], at: 16 });
  // Out of scope: a checker error. --noCheck accepts it, the same tsc without --noCheck reports TS1274.
  const semantic = "function f<in T>(x: T) {}\n";
  want("semantic, --noCheck", pick(tsc(semantic, "typescript")), { verdict: "accept", codes: [], at: null });
  want("semantic, without --noCheck", pick(tsc(semantic, "typescript", noCheckless)), { verdict: "syntax", codes: [1274], at: 11 });
  // Hangul (3 UTF-8 bytes, 1 UTF-16 unit) and an astral character (4 bytes, 2 units) before the error, and other line breaks.
  want("hangul", pick(tsc('let a = "한글"; let = ;', "typescript")), { verdict: "syntax", codes: [1109], at: 24 });
  want("astral", pick(tsc('let a = "한😀"; let = ;', "typescript")), { verdict: "syntax", codes: [1109], at: 25 });
  want("line breaks", pick(tsc("let a = 1;\r\nlet b = 2;\rlet c = 3;\u2028let = ;", "typescript")), { verdict: "syntax", codes: [1109], at: 42 });
  want("tsx", pick(tsc("const a = <div>&amp;</div>;", "tsx")), { verdict: "accept", codes: [], at: null });
  console.log(wrong.length ? `self-test: ${wrong.length} differ` : "self-test: all consistent");
  process.exit(wrong.length ? 1 : 0);
}

// ---- verdicts --------------------------------------------------------------------------------------------------------
const seen = new Set();
for (const c of cases) {
  if (typeof c.id !== "string" || c.id === "" || seen.has(c.id)) fail(`bad or duplicate id ${JSON.stringify(c.id)}`);
  seen.add(c.id);
  if (typeof c.source !== "string" || !c.source.isWellFormed()) fail(`${c.id}: source must be a well-formed string`);
  if (c.source.startsWith("﻿")) fail(`${c.id}: source must not start with a BOM (tsc strips it and the offsets would shift)`);
  if (!(c.grammar in EXT)) fail(`${c.id}: grammar must be typescript or tsx`);
  if (c.sha256 !== sha256(Buffer.from(c.source, "utf8"))) fail(`${c.id}: sha256 does not match source (run --rehash)`);
}

const meta = {
  format: 1,
  tool: "tsc",
  package: TOOL.package,
  version: TOOL.version,
  integrity: TOOL.integrity,
  package_lock_sha256: sha256(lockBytes),
  arguments: TSC_ARGS,
  encoding: "utf-8",
  offsets: "UTF-8 byte offsets",
  cases_file: basename(casesPath),
  cases_sha256: sha256(casesBytes),
  runner: basename(fileURLToPath(import.meta.url)),
  runner_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
};
const results = cases.map((c) => ({ id: c.id, sha256: c.sha256, grammar: c.grammar, ...tsc(c.source, c.grammar) }));

writeFileSync(outPath, JSON.stringify({ meta, results }, null, 1) + "\n");
const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
console.log(`wrote ${basename(outPath)}: ${results.length} cases`, JSON.stringify(tally));
