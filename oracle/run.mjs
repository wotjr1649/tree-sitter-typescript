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
// tsc's line terminators: \n, \r\n, \r, U+2028, U+2029 (built from code points so the source stays plain ASCII).
const LINE_BREAK = new RegExp("\\r\\n|[\\n\\r" + String.fromCharCode(0x2028, 0x2029) + "]");

// ---- cases ---------------------------------------------------------------------------------------------------------
// The replay (replay/main.go, parseCases) applies the same rules: lines are split at \n only, a line of only space, tab
// and CR is blank, line numbers count every physical line, field names are exact (case-sensitive), `id`, `sha256`,
// `source` and `grammar` are strings (`sha256` may be missing only for --rehash), `source` has no unpaired surrogate and
// no leading U+FEFF, `expect` is an array of strings, `errorAt` an integer, `reason` a string.
const BLANK = /^[ \t\r]*$/;
const casesBytes = readFileSync(casesPath);
const cases = casesBytes
  .toString("utf8")
  .split("\n")
  .flatMap((l, i) => {
    if (BLANK.test(l)) return [];
    const where = `${basename(casesPath)}:${i + 1}`;
    let c;
    try {
      c = JSON.parse(l);
    } catch (e) {
      fail(`${where}: ${e.message}`);
    }
    if (c === null || typeof c !== "object" || Array.isArray(c)) fail(`${where}: a record must be a JSON object`);
    for (const k of Object.keys(c)) if (!KEYS.includes(k)) fail(`${where}: unknown field ${k}`);
    for (const k of ["id", "source", "grammar", ...(args.includes("--rehash") ? [] : ["sha256"])]) {
      if (typeof c[k] !== "string") fail(`${where}: ${k} must be a string`);
    }
    if ("sha256" in c && typeof c.sha256 !== "string") fail(`${where}: sha256 must be a string`);
    if ("reason" in c && typeof c.reason !== "string") fail(`${where}: reason must be a string`);
    if ("expect" in c && !(Array.isArray(c.expect) && c.expect.every((e) => typeof e === "string"))) fail(`${where}: expect must be an array of strings`);
    if ("errorAt" in c && !Number.isInteger(c.errorAt)) fail(`${where}: errorAt must be an integer`);
    if (!c.source.isWellFormed()) fail(`${where}: source has an unpaired surrogate`);
    if (c.source.charCodeAt(0) === 0xfeff) fail(`${where}: source must not start with a BOM (tsc strips it and the offsets would shift)`);
    return [c];
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
// tsc counts lines at its line terminators and columns in UTF-16 code units (1-based both); the verdict file records
// UTF-8 byte offsets, the tree-sitter unit. Returns the offset, or null when (line, col) is not a position of the source:
// the line must exist and the column must lie on it (one past its last unit is the end of the line).
function byteOffset(src, line, col) {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const m = LINE_BREAK.exec(src.slice(start));
    if (!m) return null;
    start += m.index + m[0].length;
  }
  const m = LINE_BREAK.exec(src.slice(start));
  const end = m ? start + m.index : src.length;
  const utf16 = start + col - 1;
  if (line < 1 || col < 1 || utf16 > end) return null;
  const unit = src.charCodeAt(utf16);
  if (utf16 > 0 && unit >= 0xdc00 && unit <= 0xdfff && (src.charCodeAt(utf16 - 1) & 0xfc00) === 0xd800) return null; // inside a surrogate pair
  return Buffer.byteLength(src.slice(0, utf16), "utf8");
}

const TSC_JS = join(here, "node_modules", "typescript", "bin", "tsc");
// The shape of a diagnostic line, indented or not; the file name is compared separately and exactly.
const DIAG = /^(\s*)(\S.*?)\((\d+),(\d+)\): error TS(\d+): /;

class Inconsistent extends Error {}
const bad = (msg) => {
  throw new Inconsistent(msg);
};

// Turns tsc's output for `source` into { verdict, codes, at }; `at` is the first diagnostic. Anything that does not fit
// is an inconsistent run (Inconsistent): output on stderr; a line that is not a diagnostic (an indented line is the
// continuation of a chained message only when it is not itself shaped like a diagnostic); a diagnostic for another file
// than `case.ts`/`case.tsx`; a position that is not on the source (every diagnostic is checked); an exit status that
// disagrees with the output (0 exactly when there is no diagnostic).
function parseOutput(source, grammar, stdout, stderr, status) {
  const file = `case.${EXT[grammar]}`;
  if (stderr !== "") bad(`tsc wrote to stderr: ${stderr.trim()}`);
  const codes = [];
  let at = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line === "") continue;
    const m = DIAG.exec(line);
    if (!m) {
      // A line that says `error TSnnnn:` but has no file position is a diagnostic that cannot be attributed, never a
      // continuation (for example an indented `error TS6053: File not found.`).
      if (/\berror\s+TS\d+\s*:/.test(line)) bad(`diagnostic without a file position: ${JSON.stringify(line)}`);
      if (/^\s/.test(line) && codes.length > 0) continue; // continuation of a chained message
      bad(`unparseable output line: ${JSON.stringify(line)}`);
    }
    if (!/^[1-9]\d{0,4}$/.test(m[5])) bad(`diagnostic code TS${m[5].slice(0, 12)} is not a small positive integer: ${JSON.stringify(line.slice(0, 120))}`);
    if (m[1] !== "" || m[2] !== file) bad(`diagnostic for ${JSON.stringify(m[2])}, not for ${file}: ${JSON.stringify(line)}`);
    const pos = byteOffset(source, Number(m[3]), Number(m[4]));
    if (pos === null) bad(`position ${m[3]},${m[4]} is not on the source: ${JSON.stringify(line)}`);
    codes.push(Number(m[5]));
    at ??= pos;
  }
  if ((codes.length === 0) !== (status === 0) || status > 2) bad(`exit status ${status} does not fit ${codes.length} diagnostics`);
  return { verdict: codes.length ? "syntax" : "accept", codes, at };
}

// Runs tsc on one source (see parseOutput); a failed or timed-out process is inconsistent too.
function tsc(source, grammar, extraArgs = TSC_ARGS) {
  const dir = mkdtempSync(join(tmpdir(), "oracle-tsc-"));
  const file = `case.${EXT[grammar]}`;
  let result;
  let inconsistent = null;
  try {
    writeFileSync(join(dir, file), Buffer.from(source, "utf8"));
    // Fresh directory, no tsconfig; node + tsc.js instead of the .bin shim so that Windows and Linux run the same thing.
    const r = spawnSync(process.execPath, [TSC_JS, ...extraArgs, file], { cwd: dir, encoding: "utf8", timeout: 120000 });
    if (r.error || r.signal) bad(`tsc did not finish (${r.error?.message ?? r.signal})`);
    result = parseOutput(source, grammar, r.stdout, r.stderr, r.status);
  } catch (e) {
    if (!(e instanceof Inconsistent)) throw e;
    inconsistent = e.message;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // fail() exits the process, so it runs only after the temporary directory is gone.
  if (inconsistent !== null) fail(`${file}: ${inconsistent}`);
  return result;
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
// The manifest must pin the version exactly (a range such as ">=7.0.2 <7.0.3" would let a new lock move the oracle).
const manifest = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
if (manifest.dependencies?.[TOOL.package] !== TOOL.version) {
  fail(`package.json must pin ${TOOL.package} exactly to ${TOOL.version}, it says ${JSON.stringify(manifest.dependencies?.[TOOL.package])}`);
}
const entry = lock[`node_modules/${TOOL.package}`];
if (entry.integrity !== TOOL.integrity || lock[""].dependencies?.[TOOL.package] !== TOOL.version) {
  fail(`${TOOL.package}: lock integrity ${entry.integrity} / package.json pin differ from ${TOOL.version} ${TOOL.integrity}`);
}

// ---- self-test -------------------------------------------------------------------------------------------------------
// Proves the three kinds of answer the owner asked for, the UTF-16 -> UTF-8 position conversion, and that mocked
// inconsistent output is refused.
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
  const ls = String.fromCharCode(0x2028);
  want("line breaks", pick(tsc(`let a = 1;\r\nlet b = 2;\rlet c = 3;${ls}let = ;`, "typescript")), { verdict: "syntax", codes: [1109], at: 42 });
  want("tsx", pick(tsc("const a = <div>&amp;</div>;", "tsx")), { verdict: "accept", codes: [], at: null });
  // Mocked tsc output that must be refused as an inconsistent run (none of it is a real tsc answer).
  const refused = (name, source, grammar, stdout, status = 1) => {
    let msg = null;
    try {
      parseOutput(source, grammar, stdout, "", status);
    } catch (e) {
      if (!(e instanceof Inconsistent)) throw e;
      msg = e.message;
    }
    want(`refused, ${name}`, msg !== null, true);
  };
  const D = "error TS1109: Expression expected.";
  refused("another file name (case.tsx for case.ts)", "let x = ;", "typescript", `case.tsx(1,9): ${D}\n`);
  refused("an indented diagnostic of another file", "let x = ;", "typescript", `case.ts(1,9): ${D}\n  other.ts(1,9): ${D}\n`);
  refused("a column beyond the line", "let x = ;\nlet y = ;", "typescript", `case.ts(1,12): ${D}\n`);
  refused("a line beyond the source", "let x = ;", "typescript", `case.ts(1,9): ${D}\ncase.ts(99,1): ${D}\n`);
  refused("an output line that is no diagnostic", "let x = ;", "typescript", `case.ts(1,9): ${D}\nsomething else\n`);
  refused("an exit status that disagrees", "let x = ;", "typescript", `case.ts(1,9): ${D}\n`, 0);
  refused("an indented diagnostic-like line without a position", "let x = ;", "typescript", `case.ts(1,9): ${D}\n  error TS6053: File not found.\n`);
  refused("a diagnostic code with 400 digits", "let x = ;", "typescript", `case.ts(1,9): error TS${"9".repeat(400)}: x.\n`);
  refused("a diagnostic code of 0", "let x = ;", "typescript", "case.ts(1,9): error TS0: x.\n");
  want("a chained message is one diagnostic", parseOutput("let x = ;", "typescript", "case.ts(1,9): error TS2345: a.\n  b.\n", "", 1), { verdict: "syntax", codes: [2345], at: 8 });
  console.log(wrong.length ? `self-test: ${wrong.length} differ` : "self-test: all consistent");
  process.exit(wrong.length ? 1 : 0);
}

// ---- verdicts --------------------------------------------------------------------------------------------------------
if (cases.length === 0) fail(`${basename(casesPath)} holds no cases: an empty oracle checks nothing`);
const seen = new Set();
for (const c of cases) {
  if (typeof c.id !== "string" || c.id === "" || seen.has(c.id)) fail(`bad or duplicate id ${JSON.stringify(c.id)}`);
  seen.add(c.id);
  if (typeof c.source !== "string" || !c.source.isWellFormed()) fail(`${c.id}: source must be a well-formed string`);
  if (c.source.charCodeAt(0) === 0xfeff) fail(`${c.id}: source must not start with a BOM (tsc strips it and the offsets would shift)`);
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
