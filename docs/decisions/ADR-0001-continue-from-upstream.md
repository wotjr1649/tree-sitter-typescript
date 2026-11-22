# ADR-0001: Continue from upstream v0.23.2

- Status: accepted (owner decision, 2026-11-18)
- Date: 2026-11-18
- Amended: 2026-11-19 (versioning from v2.0.0, see the Amendment section)

## Context

`go-treesitter` builds its TypeScript and TSX grammars from `tree-sitter/tree-sitter-typescript` commit `75b3874`,
whose grammar files equal release v0.23.2 (`f975a62`), generated against the npm package tree-sitter-javascript
0.23.1. Needed fixes there exceed what go-treesitter's patch records can carry; TypeScript, for example, needs a newer
JavaScript grammar as a generation input. go-treesitter's ADR-0024 rule 7 lets the owner maintain such a grammar in an
independent repository, as `wotjr1649/tree-sitter-mssql` already does for T-SQL.

## Decision

1. Continue both grammars in this repository from upstream v0.23.2 (`f975a621f4e7f532fe322e13c4f79495e0a7b2e7`),
   merged with its full history. The repository is independent: later upstream changes are adopted deliberately, one
   change at a time, never synchronized automatically. Upstream tags stay out of `refs/tags`; v0.23.2 is kept as
   `refs/upstream/v0.23.2`.
2. The JavaScript grammar that `common/define-grammar.js` extends is vendored as
   `third_party/tree-sitter-javascript/grammar.js` in place of the npm dependency. Through v2.0.0 it came unchanged
   from upstream tree-sitter-javascript v0.23.1 (`3a837b6`, grammar SHA-256
   `230e330dd914d94297e5e58d53942cd5debf9c069852da93b6a6b1daae1967dc`). The port switches the input to
   `wotjr1649/tree-sitter-javascript` v4.4.0 (tag object `a907252`, commit `e5ada30`). The JavaScript queries that
   `tree-sitter.json` combines with this repository's come from the same tag, along with its `LICENSE`. `NOTICE`
   records the source and SHA-256 of every vendored file. CI checks each hash and the file set under `third_party/`.
3. Own versions start at v1.0.0, which equals the v0.23.2 baseline behaviour: regenerated with tree-sitter CLI 0.27.2,
   `parser.c`, `grammar.json`, `node-types.json` and the headers of both grammars are byte-identical to what
   go-treesitter generates from the old source. `tree-sitter.json` keeps `metadata.version` `0.23.2` because
   `tree-sitter generate` embeds it in `parser.c`; the other manifests say `1.0.0`. It takes the real version from the
   first behaviour-changing release (v1.1+) (owner decision, 2026-11-18).
4. No registry publishing (npm, crates.io, PyPI) and no automated tagging or releases. Consumers pin commits.
5. Node kinds and field names stay a public contract: removing or renaming one is breaking. The grammar names
   `typescript` and `tsx` and the C symbols `tree_sitter_typescript` and `tree_sitter_tsx` stay.
6. The parsers are ABI 15 (upstream v0.23.2 committed ABI 14). Binding runtime lower bounds move to the first
   ABI 15-capable line, 0.25 (Rust, Node, Python, Go, Swift), and the CMake default ABI to 15. py-tree-sitter 0.25
   needs Python 3.10, so the Python package's minimum moves from 3.9 to 3.10 (`requires-python`, abi3 tag `cp310`,
   `Py_LIMITED_API` 0x030A0000).
7. The planned oracle for later fixes is the TypeScript compiler (`tsc`) parser: a fix that changes which inputs
   parse cites tsc's verdict. It is not set up yet.

## Consequences

- Pinned commits stay reachable because this repository does not rewrite its history.
- The inherited publication workflow is gone; test, lint and fuzz CI stay. The test workflow uses CLI 0.27.2 and
  checks that the committed parsers match it.
- Binding consumers need tree-sitter runtime 0.25 or later, and Python consumers Python 3.10 or later.
- The Go module path started as `github.com/wotjr1649/tree-sitter-typescript` (owner decision, 2026-11-18).
  Releases v2.0.0 and v3.0.0 add the `/v2` and `/v3` suffixes, respectively (amendment below, Decision 9).
- CI parses example repositories at pinned commits; the files the baseline grammar cannot parse are listed in
  `test/examples/known-failures.txt`, which may only shrink as the v1.1 grammar fixes land (owner decision,
  2026-11-18). CI fails a pull request that adds a path to it without changing the pins in `test/examples/repos.txt`.
- One maintainer owns the grammars; the dependency moves from upstream's maintainers to this repository's owner.


## Amendment 2026-11-19: versioning from v2.0.0

Status: accepted (owner decision, 2026-11-19). It replaces the version wording of Decision 3 and of the last
Consequences bullet above ("the real version from the first behaviour-changing release (v1.1+)", "as the v1.1 grammar
fixes land") and refines Decision 4. Everything else in this record stands.

1. **v1.0.0 is the baseline.** It is the v0.23.2 grammar regenerated with CLI 0.27.2 and has the same parse behaviour.
   Nothing that changes a tree was ever released under 1.x.
2. **The first behaviour-changing release is v2.0.0, not v1.1.0.** It contains the fixes S1-S6, N1-N5, N1b and N7
   (one per defect class), and some of them change the tree of input that parsed without error at v1.0.0 (for example
   a tagged template with type arguments, `accessor` followed by a line break, `f<typeof import('m')>(x)`, a block
   comment before `?` that was missing from the tree, `return` followed by a lone CR or U+2028). Under the rule below a
   tree change of previously error-free input is a MAJOR change.
   Calling that release v1.1.0 would tell a consumer that its queries and walkers still work; they may not.
3. **Rule (SemVer 2.0.0, as in `tree-sitter-mssql` ADR-0007 §3).** For releases from v2.0.0 on:
   - MAJOR: a node kind or field is removed or renamed, or the tree of an input that parsed without error before changes.
   - MINOR: node kinds, fields or accepted syntax are added, and inputs that were errors parse; no previously error-free
     tree changes.
   - PATCH: no tree of valid input changes (performance, the shape of an error tree, documentation, CI, bindings).
   The grammar names `typescript` and `tsx` and the C symbols `tree_sitter_typescript` and `tree_sitter_tsx` stay
   (Decision 5). A change that makes input that parsed without error an error is a tree change and counts as MAJOR too.
4. **`tree-sitter.json` `metadata.version` equals the release version.** From v2.0.0 `tree-sitter generate` embeds the
   real version in both `parser.c` files, and every manifest (`package.json`, `package-lock.json`, `Cargo.toml`,
   `Cargo.lock`, `pyproject.toml`, `CMakeLists.txt`, `common/common.mak`, `tree-sitter.json`) carries the same version.
   The exception of Decision 3 (a `0.23.2` kept for byte equality with the baseline) ends at v2.0.0. A fix pull request
   before a release leaves every version alone; the release pull request changes them together.
5. **Tags and releases.** A release is the tag `vMAJOR.MINOR.PATCH` plus a GitHub Release whose notes are the CHANGELOG
   section. The v1.0.0 tag already exists. Each tag and each Release needs the owner's separate approval (as does any
   merge); agents prepare the branch, the commit and the release pull request, and do not create tags or Releases on
   their own. No registry publishing (npm, crates.io, PyPI) and no tag-triggered automation: this refines Decision 4,
   which said "no automated tagging or releases"; a manual, owner-approved tag and Release is allowed. Consumers still
   pin commits.
6. **CHANGELOG and migration.** `CHANGELOG.md` follows Keep a Changelog and SemVer. A MAJOR release ships a migration
   document (`docs/migrating-from-1.0.md` for v2.0.0) listing every error-free tree change with before and after trees,
   the schema additions, and the recorded known differences from tsc. A MINOR or PATCH release needs none unless it finds
   something to record.
7. **The JavaScript-grammar switch** (Decision 2) is versioned by comparing both grammars against the current release
   with the tsc 7.0.2 oracle and the node-kind snapshots (`test/node-kinds`). The v4.4.0 port ships in v3.0.0 under the MAJOR rules
   in `AGENTS.md`. It changes previously error-free trees of valid input in both grammars. See the
   [migration guide](../migrating-from-2.0.md).
8. **`test/examples/known-failures.txt`.** The grammar fixes that Decision 3 and the last Consequences bullet called
   "v1.1" landed as v2.0.0. The entries for constructs the release does not fix are marked `candidate:`; they may be
   fixed in a later MINOR (error to ok) or MAJOR release. The list still may only shrink, and a pull request that adds a
   path still needs a change to `test/examples/repos.txt`.
9. **Go module path.** In v2.0.0 the module was `github.com/wotjr1649/tree-sitter-typescript/v2`, as Go requires for
   a major version above 1. In v3.0.0 the module moves to `github.com/wotjr1649/tree-sitter-typescript/v3`, and the
   bindings import as `github.com/wotjr1649/tree-sitter-typescript/v3/bindings/go`. Each later MAJOR release moves the
   suffix again. CI checks that the manifests and the latest CHANGELOG version agree.
10. **Oracle.** The oracle of Decision 7 is set up in `oracle/`: `typescript` 7.0.2 `tsc` with `--noEmit --noCheck`
    gives each case's verdict, and CI replays the committed cases against both grammars; the committed cases have no
    mismatch with tsc. Checker-only errors are out of scope.
