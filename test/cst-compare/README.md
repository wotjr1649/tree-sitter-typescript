# TypeScript and TSX CST comparison

## Compare a grammar change against main

From a checkout containing this tool, fetch the baseline and pass the two
committed revisions. Use a candidate commit that includes the generated
parsers.

```powershell
git fetch --no-tags origin main
jobrun --timeout 3600 -- python -u -B test/cst-compare/compare.py origin/main HEAD grammar-pr
```

Use Windows with PowerShell 7, Python 3.12 or later, Git, GCC (MSYS2 UCRT64),
Go, and the Node.js and npm versions supported by the selected oracle.
The Python runner uses only the standard library. Use trusted revisions:
the runner evaluates their grammar JavaScript, runs the selected oracle
self-test and builds and loads their C parsers and scanners.

Install the Tree-sitter executable matching the candidate's
`devDependencies.tree-sitter-cli` in `package.json`. The runner uses
`tree-sitter` on PATH or an executable supplied with `--cli`. If the
baseline pins a different version, pass its executable with `--base-cli`.
The runner checks each CLI before use. It regenerates in scratch with
`generate --abi <ABI> --js-runtime native` using each revision's ABI pin
(or the committed parser ABI for revisions before the pin file). CST
comparison uses the committed C sources.

The first run downloads the pinned example trees, Go runtime, npm oracle
and two fixture source files into the gitignored
`build/cst-compare/cache/default/`. Use `--cache-name` with a new name for an
empty cache. Each cache supports one run at a time. Choose a new run name
for each invocation. Results go to `build/cst-compare/results/<run-name>/`.

## Comparison inputs

By default the baseline provides the fixed corpus, oracle, tracked
examples and external example pins. It also provides the compiler from
`oracle/package-lock.json` and the comparison runtime from
`oracle/replay/go.mod` and `go.sum`. Pass `--inputs-ref` to fix these to a
different Git revision for comparisons across multiple releases. Both
parsers receive the same inputs and share the runtime and syntax checker.
The runtime must support both parser ABIs.

The runner includes new corpus and oracle sources from the compared
revisions and runs unqualified corpus cases with both grammars. It keeps
all cases in the fixed corpus and deduplicates added sources within each
revision by dialect and input group. It reads historical JavaScript
sequences directly from [the fixture manifest](../cst-regressions/fixtures.jsonl) and
verifies all source and edit hashes. Range fixture fresh comparisons
use only the concatenated included bytes. The syntax checker reuses
validated oracle verdicts when their lockfile matches the selected one
and checks other inputs with the same pinned native `tsc`.

To reproduce the complete v3.0.0 to v3.1.0 comparison, fetch the release
tags and explicitly select the historical input and toolchain revision.
Use a previously unused cache name for each cold run.

```powershell
git fetch --tags origin
jobrun --timeout 3600 -- python -u -B test/cst-compare/compare.py v3.1.0 v3.1.0 same-release --cache-name cold-same --expect-identical
jobrun --timeout 3600 -- python -u -B test/cst-compare/compare.py v3.0.0 v3.1.0 release-delta --inputs-ref v2.0.0 --cache-name cold-delta
```

## Read the verdict

`summary.json` records the resolved baseline, candidate and input SHAs,
CLI versions, ABIs, runtime and `tsc` versions, fixture manifest SHA-256,
example pins and per-dialect evidence. The overall verdict is evaluated
in this order.

| Verdict | Evidence |
| --- | --- |
| `MAJOR` | A breaking node contract change or a CST change on valid input that the baseline parsed without errors. |
| `REVIEW` | A changed CST on invalid input that both parsers accepted. Inspect the affected rows and any concurrent MINOR evidence. |
| `MINOR` | Compatible contract additions, error-to-clean, changed error-to-error, or invalid clean-to-error. |
| `IDENTICAL` | All measured fresh CSTs and node contracts agree. The release class for tree-identical work still follows [the project SemVer rules](../../AGENTS.md). |

The per-dialect incremental section counts each side's mismatches against
a fresh parse of the edited input (`baseline_divergences` and
`candidate_divergences`). It also counts new or resolved mismatches
between sides, changed check records and exact cross-version differences.
A changed included-range list triggers a fresh parse, counted in
`fresh_after_range_change`. Generation drift, forbidden pragmas, example
gate differences and incremental checks are reported independently of
the fresh CST verdict.

- `typescript.jsonl` and `tsx.jsonl` record classification, syntax validity,
  ERROR/MISSING status and the first CST difference, including anonymous
  and extra nodes, fields, and byte and point ranges.
- `*-incremental.jsonl` records byte edits, range changes and comparisons
  of the edited trees.
- `*-contract.json` records changes to kinds, fields, children and
  supertype subtypes.
- `*-major.jsonl` records reduced sources that preserve the qualifying
  difference and pass the syntax checker. Completed runs can supply reduction
  seeds. `--smoke` limits reduction to one reproduction per dialect while
  still comparing the full input set.

A completed comparison reports differences through its output files.
Use `--expect-identical` to fail on a non-identical verdict, a changed
incremental comparison, generation drift, forbidden pragmas or a
mismatch with either side's known example failure list. Check the
per-side incremental counts even when this flag passes, since both
versions can have the same mismatch.
