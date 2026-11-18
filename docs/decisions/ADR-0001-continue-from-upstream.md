# ADR-0001: Continue from upstream v0.23.2

- Status: accepted (owner decision, 2026-11-18)
- Date: 2026-11-18

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
   `third_party/tree-sitter-javascript/grammar.js`, copied unchanged from tree-sitter-javascript v0.23.1 (`3a837b6`,
   SHA-256 `230e330dd914d94297e5e58d53942cd5debf9c069852da93b6a6b1daae1967dc`), in place of the npm dependency.
   `NOTICE` records the source and CI checks the hash. A later release may switch it to a named tag of the
   owner-maintained JavaScript grammar.
3. Own versions start at v1.0.0, which equals the v0.23.2 baseline behaviour: regenerated with tree-sitter CLI 0.27.2,
   `parser.c`, `grammar.json`, `node-types.json` and the headers of both grammars are byte-identical to what
   go-treesitter generates from the old source.
4. No registry publishing (npm, crates.io, PyPI) and no automated tagging or releases. Consumers pin commits.
5. Node kinds and field names stay a public contract: removing or renaming one is breaking. The grammar names
   `typescript` and `tsx` and the C symbols `tree_sitter_typescript` and `tree_sitter_tsx` stay.
6. The planned oracle for later fixes is the TypeScript compiler (`tsc`) parser: a fix that changes which inputs
   parse cites tsc's verdict. It is not set up yet.

## Consequences

- Pinned commits stay reachable because this repository does not rewrite its history.
- The inherited publication workflow is gone; test, lint and fuzz CI stay, pinned to CLI 0.27.2.
- `tree-sitter.json` still names JavaScript queries under `node_modules/tree-sitter-javascript/`, which is no longer
  installed. Query tooling that follows those paths needs them supplied until the queries are vendored or rewritten.
- One maintainer owns the grammars; the dependency moves from upstream's maintainers to this repository's owner.
