# TypeScript oracle

`tsc` says whether a TypeScript or TSX source is syntactically valid; CI replays its verdicts against both grammars through the tree-sitter API. It guards fixes: a case is registered only when the grammar already agrees with `tsc`, so there is no expected-failure list. The input of a fix enters here, as a passing case, in the pull request that fixes it. (`test/examples/known-failures.txt` is a separate list and is not affected.)

| Path | Holds |
| --- | --- |
| `package.json`, `package-lock.json` | The oracle, exact version: `typescript` 7.0.2 (`npm ci --ignore-scripts`; the lock holds every platform binary package, integrity `sha512-8FYau96o…`). Separate from the root `package.json` |
| `cases.jsonl` | The cases, one JSON record per line |
| `run.mjs` | The verdict runner (Node, ESM) and its self-test |
| `verdicts.json` | The committed verdicts, produced by `run.mjs` |
| `replay/` | The Go replay (nested module `replay/go.mod`: `github.com/tree-sitter/go-tree-sitter` v0.25.0 through cgo, the repository's `bindings/go` for both grammars through a `replace`; the root `go.mod` is untouched); `judge_test.go` is its self-test |
| `../test/node-kinds/` | Node-kind and field snapshot of each grammar and the script that writes it (below) |

## The oracle

`tsc` 7.0.2 (the native TypeScript 7 compiler; it has no programmatic API, so the CLI is the interface) runs once per case, in a fresh temporary directory without a `tsconfig`, on a file `case.ts` (grammar `typescript`) or `case.tsx` (grammar `tsx`), with exactly

```
--noEmit --noCheck --pretty false --target esnext --jsx preserve
```

`--noCheck` drops every checker diagnostic, so what remains is the parser's. Checker-reported grammar errors are out of scope by design: `function f<in T>(x: T) {}` (TS1274), `readonly accessor x = 1` (TS1243), `type A<in in T> = T;` (TS1030), `f<>(x);` (TS1099) are all *accepted* here. A source with no diagnostic is `accept`; any diagnostic is `syntax`.

| Verdict | Meaning | Recorded in `verdicts.json` |
| --- | --- | --- |
| `accept` | `tsc` reports nothing | `codes: []`, `at: null` |
| `syntax` | `tsc` reports at least one diagnostic | `codes`: the TS codes in order, `at`: the first diagnostic's position as a **UTF-8 byte offset** (`tsc` prints a 1-based line and a UTF-16 column; the runner counts lines at `\n`, `\r\n`, `\r`, U+2028, U+2029 like `tsc`) |

An **inconsistent run** (exit 2, nothing written) is: a diagnostic for any file name other than the case file (compared exactly, indented or not), an output line that is no diagnostic (an indented line counts as the continuation of a chained message only when it is not itself shaped like a diagnostic), a diagnostic whose line and column are not on the source (every diagnostic is checked, not only the first), anything on stderr, a failed or timed-out process, an exit status that disagrees with the output (0 exactly when there is no diagnostic), a diagnostic code that is not an integer from 1 to 99999, a line that says `error TSnnnn:` without a file position (an indented one is not a continuation of a chained message), or an installed `typescript` or platform package that differs from the pin or the lockfile, or a `package.json` that does not pin `typescript` to exactly `7.0.2`. The self-test feeds mocked output of each kind to the parser of `tsc`'s output and requires it to be refused. The temporary directory of a refused run is removed before the runner exits.

`node oracle/run.mjs --self-test` proves the three kinds of answer and the position conversion on fixed inputs (it writes nothing). Its result, with 7.0.2 (CI runs it too):

```
ok   accepted: const x: number = 1;                          -> accept
ok   rejected: let x: number = ;                              -> syntax, TS1109 at 16
ok   semantic, --noCheck: function f<in T>(x: T) {}           -> accept (out of scope)
ok   semantic, without --noCheck: the same source             -> syntax, TS1274 at 11 (the checker's error, shown only to prove --noCheck hides it)
ok   hangul / astral / line breaks: errors after 한글, 😀, \r\n \r U+2028 -> UTF-8 offsets 24, 25, 42
ok   tsx: const a = <div>&amp;</div>;                         -> accept
```

`verdicts.json` does not depend on platform, path or time (CI regenerates it on Linux and compares the bytes). Its `meta` holds the tool, version, npm integrity, `package_lock_sha256`, the exact arguments, encoding, `cases_sha256` and the runner's own `runner_sha256`.

## What the replay requires of the tree-sitter tree

The replay parses each case with the grammar named by the case (`typescript` or `tsx`) and judges the tree through the API (`Node.HasError`, `IsError`, `IsMissing`, children by index, byte ranges), never through a CLI summary.

| Verdict | Requirement |
| --- | --- |
| `accept` | The tree is **faithful** (below), and every `expect` entry holds. An accepted case whose tree has an error (or is not faithful) is refused: there is no way to register it |
| `syntax` | The root has an error, and an `ERROR` or `MISSING` node holds `errorAt` (below). A rejected case whose tree is clean is refused too |

**Faithful tree**: the root does not report `has_error`; there is no `ERROR` node, no `MISSING` node and no zero-width node (other than the root of an empty input); and the leaves cover the input, that is every byte outside all leaves is white space (Unicode `White_Space`, U+FEFF, U+200B, U+2060: the gaps the grammar's `extras` skip). At `59fc4ed` the grammar produces no zero-width node on valid input: the 17,607 example files that parse without error (`test/examples/repos.txt`) all satisfy the rule, so it has no exceptions. The coverage clause is not decoration: at `59fc4ed` it finds a block comment that is silently left out of the tree (`a⏎/* c */ ? b : c;`: no node covers the comment, there is no `ERROR` node and no zero-width node), so that input cannot be registered until the grammar is fixed.

**`expect`** (accept cases): entries `s-e:kind`; the deepest node whose range covers bytes `[s,e)` has that kind (the first one in document order among equals), as in go-treesitter's `testdata/korean/manifest.csv`. Offsets are UTF-8 bytes. Anonymous nodes count: `7-10:out` names a keyword token, `7-10:type_identifier` the named node.

**`errorAt`** (syntax cases): the decided error position, a UTF-8 byte offset. It equals `tsc`'s first diagnostic position (`at` in `verdicts.json`) unless the case has a `reason` saying why another position is the right one; the replay requires a `reason` exactly when the two differ. It holds when some `ERROR` or `MISSING` node starts at or before `errorAt` and either contains it (`start <= errorAt <= end`) or ends before it with only white space in between (recovery leaves the node on the last good token while `tsc` names the next one), **and** `errorAt` does not lie inside a token the parser read well that is only a part of that node. The second clause stops a wide recovery `ERROR` from agreeing with a complaint about a token it kept: for `type A<in> =` `tsc` reports TS1359 at the `in` (byte 7), the grammar reads `in` as a `type_identifier [7,9)` inside one `ERROR [0,12)`, so `errorAt` 7 does not hold (the grammar's error is the missing right-hand side, byte 12, which is a different error). An `ERROR` that is exactly the offending token (`<p>></p>`: `ERROR [3,4)` holding the one leaf `>`) holds.

**`expect`** (syntax cases, optional): entries that pin the problem node itself, not only a position near it. `s-e:ERROR` asserts an `ERROR` node with exactly the byte range `[s,e)`; `s-e:MISSING:kind` asserts a `MISSING` node of that kind with exactly that range (`8-8:MISSING:identifier`). Use it when the case is meant to guard one specific error shape; a fix that moves the recovery changes the entry in the same pull request. **Relation to `errorAt`:** when an entry asserts an exact problem node that is in the tree and whose range contains `errorAt` (`s <= errorAt <= e`), that node satisfies `errorAt` by itself; the stricter rule above (no position inside a well-formed token of a wide `ERROR`) then does not apply, because the author has named the node that carries the error. Without such an entry the stricter rule stays. Example, unclosed JSX `<p>x` (tsx): `tsc` reports TS17008 at the tag name (byte 1) and TS1005 at the end; the grammar keeps `p` as an `identifier [1,2)` inside one `ERROR [0,4)`. With `errorAt` 1 the case is refused as it stands and accepted with `"expect":["0-4:ERROR"]`. An entry whose node is not in the tree, or whose range does not contain `errorAt`, does not help. Both kinds of `expect` entry are refused on the wrong verdict (exit 2).

## Case records

```json
{"id":"s1/out-param.ts","sha256":"…","source":"type A<out> = out;","grammar":"typescript","expect":["7-10:type_identifier","14-17:type_identifier"]}
{"id":"s2/export-type-star-no-from.ts","sha256":"…","source":"export type *;","grammar":"typescript","errorAt":13}
```

`id` is unique (the convention is `<defect class>/<name>.ts` or `.tsx`); `sha256` is the hash of the UTF-8 bytes of `source` (a source must be well-formed Unicode and must not start with U+FEFF, which `tsc` strips); `grammar` is `typescript` or `tsx`; `expect` (an `accept` case: deepest-node entries; a `syntax` case: `ERROR` / `MISSING:kind` entries); `errorAt` required for, and only with, a `syntax` verdict; `reason` only with an `errorAt` that differs from `tsc`'s. Both tools read the file by the same rules: lines are split at `\n` only, a line of only space, tab and CR is blank, line numbers count every physical line, every other line is exactly one JSON object (a `null`, a stray `]` or trailing text is exit 2), field names are exact and case-sensitive (an unknown or differently-cased name is exit 2), `id`, `sha256`, `source` and `grammar` are strings (not `null`), `source` has no unpaired surrogate and no leading U+FEFF, `expect` is an array of strings, `errorAt` an integer and `reason` a string, and the file must hold at least one case: an empty set is exit 2 in both tools, so the oracle cannot pass by checking nothing. `verdicts.json` has `meta` and `results` (per case: `id`, `sha256`, `grammar`, `verdict`, `codes`, `at`).

## Run

```sh
(cd oracle && npm ci --ignore-scripts)
node oracle/run.mjs --self-test            # the three verdict kinds and the position conversion
node oracle/run.mjs                        # rewrites oracle/verdicts.json; byte-identical on every run
(cd oracle/replay && go test .)            # self-test of the judging logic
(cd oracle/replay && go run . -oracle ..)  # judge; add -tree to print every tree with byte ranges
(cd oracle/replay && go run . -judge FILE.jsonl)   # judge the records (id, grammar, source) of any JSON Lines file, no verdicts
```

`run.mjs --rehash` fills in or fixes every `sha256` and rewrites `cases.jsonl` in its canonical form. `run.mjs --cases FILE --out FILE` works on other files (scratch runs).

Exit codes of `run.mjs`: 0 verdicts written (or self-test consistent); 1 `--self-test` found a differing result; 2 inconsistent inputs or an inconsistent `tsc` run, nothing written.

Exit codes of the replay:

- **0**: every case is consistent.
- **1**: a result differs; the differences are listed. Registering such a case is not an option (rule: no mismatch in the committed set).
- **2**: the inputs are inconsistent: a `sha256` that does not match its source, verdicts made from other cases (`cases_sha256`), another runner (`runner_sha256`) or another `package-lock.json`, a tool version, an npm integrity or a `tsc` argument list (`meta.arguments`) that differs from the values written into the replay (7.0.2, `sha512-8FYau96o…`, `--noEmit --noCheck --pretty false --target esnext --jsx preserve`) in the verdicts or the lock, a `package.json` whose pin is not exactly 7.0.2, any `@typescript/typescript-*` package of the lock at another version, no cases, a case that does not fit its verdict, or a grammar that cannot be loaded. Nothing is judged.

CI (`oracle` job of `.github/workflows/ci.yml`, `ubuntu-24.04`): `npm ci --ignore-scripts`, the runner self-test, regenerate `verdicts.json` and fail on any difference from the committed file (the file must be tracked: `git ls-files --error-unmatch` runs first, because `git diff` passes for an untracked file), the replay self-test, the replay, and the node-kind snapshot check.

## Adding cases in a fix pull request (rule (b))

1. Write the failing input first (a corpus test or here). Append its record to `cases.jsonl` (`id`, `source`, `grammar`; leave `sha256` empty or wrong).
2. `node oracle/run.mjs --rehash`, then `node oracle/run.mjs`; read the verdict and, for a `syntax` case, `at` in `verdicts.json`. An input `tsc` accepts only because `--noCheck` hides a checker error (see above) is not a defect input for a syntax fix.
3. After the fix, `go run . -oracle .. -tree` in `oracle/replay` shows the trees. For an `accept` case add `expect` entries for the nodes the fix is about; for a `syntax` case add `errorAt` (equal to `at`).
4. `node oracle/run.mjs` again; the replay must exit 0. Commit `cases.jsonl` and `verdicts.json` together. A case the grammar does not yet get right is not committed: it enters in the pull request that fixes it.

Changing the `typescript` version means changing `package.json`, `package-lock.json`, the pin and integrity in `run.mjs` and the version, integrity and arguments written into `replay/main.go`, and regenerating `verdicts.json` in the same pull request; review every verdict that moves.

## Node-kind snapshot

`node test/node-kinds/generate.mjs` writes `test/node-kinds/typescript.txt` and `test/node-kinds/tsx.txt` from `typescript/src/node-types.json` and `tsx/src/node-types.json`: one sorted line per kind; a named kind is bare or with its field names (`call_expression{arguments,function,type_arguments}`), an anonymous kind (keyword or punctuation token) is a JSON string (`"out"`). Node kinds and field names are a public contract (`AGENTS.md`): CI regenerates the files and fails on `git diff --exit-code -- test/node-kinds`, so a removal or rename shows up as a deleted line, an addition as an added line, and a grammar change that forgets to refresh the snapshot fails. A fix pull request that adds a kind runs the script and commits the result.

## Known limits

- The node-kind snapshot follows `node-types.json`. The TypeScript runtime also exposes `jsx_text` as a visible named kind (id 163) that is absent from `typescript/src/node-types.json` and so from `typescript.txt` (the TSX snapshot has it); losing that symbol would not show up as a snapshot difference.
- The `checkout@v4`, `setup-node@v4` and `setup-go@v5` actions of the `oracle` job declare Node 20 and run on Node 24 with a runner warning, like the existing jobs (same generation); moving all of them is a separate change.
- The platform binary packages (`@typescript/typescript-*`) are pinned by version only: the runner and the replay check that the installed one and every one in the lock are 7.0.2, but their integrity is not compared with a value of its own; `npm ci` verifies it against the lockfile in CI. Whether the native file on disk is the one npm unpacked is not checked.
