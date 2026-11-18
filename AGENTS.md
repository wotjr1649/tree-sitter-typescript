# AGENTS.md — tree-sitter-typescript

Owner-maintained tree-sitter grammars for TypeScript and TSX, continued from `tree-sitter/tree-sitter-typescript`
v0.23.2 (`f975a62`) to keep them correct and fix defects fast. Intended consumer: `go-treesitter`, which pins a
commit here under its ADR-0024 rule 7 and regenerates `src/parser.c` with tree-sitter CLI 0.27.2. The repository is
independent (`docs/decisions/ADR-0001-continue-from-upstream.md`): upstream v0.23.2 is commit `f975a62` in this
history, kept as `refs/upstream/v0.23.2`, and later upstream changes are adopted only deliberately.

## Rules

- Source is `common/define-grammar.js`, `typescript/grammar.js`, `tsx/grammar.js`, `common/scanner.h` and the
  hand-written `*/src/scanner.c`. `*/src/parser.c`, `*/src/grammar.json`, `*/src/node-types.json` and
  `*/src/tree_sitter/*` are generated: edit the grammar, run `tree-sitter generate --abi 15 --js-runtime native` with
  CLI 0.27.2 in `typescript/` and `tsx/`, commit both.
- `tree-sitter generate` embeds `tree-sitter.json` `metadata.version` in `parser.c`, so at v1.0.0 it stays upstream's
  `0.23.2` (the baseline bytes must not change) while the other manifests say `1.0.0`; it takes the real version
  from the first behaviour-changing release (v1.1+).
- `third_party/tree-sitter-javascript/` (`grammar.js`, the generation input, and `queries/`) is copied unchanged from a
  named tree-sitter-javascript tag. Never edit it; replacing it changes its source and SHA-256s in `NOTICE` and the
  CI check together.
- The parsers are ABI 15; binding runtime lower bounds are the 0.25 line (CMake default ABI 15). py-tree-sitter 0.25
  needs Python 3.10, so `requires-python`, the `cp310` abi3 wheel tag and `Py_LIMITED_API` (`setup.py`) say 3.10.
  Do not lower them without the owner's approval.
- `tree-sitter test` runs `test/corpus` with the `typescript` grammar only; `tsx` has no corpus of its own.
- CI parses every `.ts`/`.tsx` file of the example repositories pinned in `test/examples/repos.txt`
  (`test/examples/parse-examples.mjs`). `test/examples/known-failures.txt` lists the files that fail and why; it may
  only shrink. A new failure fails CI; a listed file that starts parsing is removed in the same change; a pull
  request that adds a path to the list fails CI unless it also changes `repos.txt`
  (`test/examples/check-known-failures-shrink.sh`). Entries marked
  `v1.1:` are the planned v1.1 grammar fixes: `typeof import(...)` as a type argument, `import(...)` types followed by
  a member, type arguments, index or `[]`, bare `&` in JSX text, `unique` after `<`, `symbol` as a tuple label,
  `abstract` as an object-type property, `\u` without hex digits in templates, and a call signature starting with `<`
  on a new line. Entries marked `not complete TypeScript` are fixture inputs, not grammar gaps. Moving a pin updates
  the list in the same change.
- Node kinds and field names are a public contract: removing or renaming one is breaking (major version, CHANGELOG;
  create `CHANGELOG.md` when the first entry is needed); adding one is not. Keep the grammar names `typescript` and
  `tsx` and the C symbols `tree_sitter_typescript` and `tree_sitter_tsx`.
- A fix starts from a failing case (corpus test or oracle case) and cites its evidence. Existing corpus tests keep
  passing unless the change alters them on purpose and says why.
- Keep every copyright line in `LICENSE` and the attribution in `NOTICE` (MIT).
- Agents prepare branches, commits and pull requests. Every merge, tag, release, publication, repository-setting
  change and deletion needs the owner's separate approval. No registry publishing (npm, crates.io, PyPI).
