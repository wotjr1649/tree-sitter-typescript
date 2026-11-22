# AGENTS.md — tree-sitter-typescript

Owner-maintained tree-sitter grammars for TypeScript and TSX, continued independently from
`tree-sitter/tree-sitter-typescript` to keep them correct and fix defects fast. See
`docs/decisions/ADR-0001-continue-from-upstream.md` for the baseline (kept as a local `refs/upstream/` ref); later
upstream changes are adopted only deliberately.

`go-treesitter` records its grammar commit and CLI pins in `tools/gen/pins.json`. Propose this repository's latest
release tag in a separate PR under go-treesitter ADR-0024 rule 7, with a comparison against its current pin and
owner approval. go-treesitter regenerates `src/parser.c` with its own pinned CLI.

## Rules

- Source is `common/define-grammar.js`, `typescript/grammar.js`, `tsx/grammar.js`, `common/scanner.h` and the
  hand-written `*/src/scanner.c`. `*/src/parser.c`, `*/src/grammar.json`, `*/src/node-types.json` and
  `*/src/tree_sitter/*.h` are generated. Regenerate both grammars with the pinned CLI using the CI generate command
  (`tree-sitter generate --abi <ABI> --js-runtime native` in `typescript/` and `tsx/`) and commit the generated files
  with the source change. Never edit generated files by hand or by post-processing. A generated `parser.c` must not
  contain the generator's optimize-off pragmas.
- The CLI pin is `devDependencies.tree-sitter-cli` in `package.json`; `ci.yml` and `fuzz.yml` read it. It
  tracks the latest stable tree-sitter release (`gh release view -R tree-sitter/tree-sitter`). Move it in its own PR:
  regenerate, compare full CSTs on the fixed inputs and record generated-code differences. Identical trees are a patch
  release; otherwise follow the SemVer rules below.
- The ABI pin is `ci/tree-sitter-abi.txt`; the CI generate command and the CMake default read it. The `build` scripts in
  `typescript/package.json` and `tsx/package.json` repeat the CI generate command with it, and the CI `abi` job checks
  them and both `parser.c`: change them together. Binding runtime lower bounds are in the binding manifests;
  py-tree-sitter's Python floor sets `requires-python`, the `cp` abi3 wheel tag and `Py_LIMITED_API` (`setup.py`)
  together. Changing the ABI or a runtime lower bound needs the owner's approval and a major release.
- `third_party/tree-sitter-javascript/` (`grammar.js`, the generation input, and `queries/`) is copied unchanged from a
  release tag of `wotjr1649/tree-sitter-javascript` (latest: `gh release view -R wotjr1649/tree-sitter-javascript`),
  within go-treesitter ADR-0024 7.7. Never edit it; replacing it changes its
  source and SHA-256s in `NOTICE` and the CI check together, and the tsx main lexer must stay below the
  optimize-off pragma threshold.
- `tree-sitter test` runs `test/corpus` with the `typescript` grammar only; `tsx` has no corpus of its own.
- CI parses every `.ts`/`.tsx` file of the example repositories pinned in `test/examples/repos.txt`
  (`test/examples/parse-examples.mjs`). `test/examples/known-failures.txt` lists the files that fail and why; it may
  only shrink. A new failure fails CI; a listed file that starts parsing is removed in the same change; a pull
  request that adds a path to the list fails CI unless it also changes `repos.txt`
  (`test/examples/check-known-failures-shrink.sh`). Entries marked `not complete TypeScript` are fixture inputs. Moving a pin updates the list in the same change.
- Releases are `vMAJOR.MINOR.PATCH` tags with a GitHub Release; the latest is
  `gh release view -R wotjr1649/tree-sitter-typescript`. Record every release in `CHANGELOG.md` (Keep a Changelog).
  - MAJOR: a node kind, field or supertype subtype is removed or renamed, or the CST of valid input that the previous
    release parsed without an error changes. Add migration notes. Valid input: `tsc`, as pinned in
    `oracle/package.json`, reports no syntax error (`oracle/README.md`).
  - MINOR: additions, error-to-ok fixes, accepted invalid input becoming an error, changes to the tree of input that
    is an error before and after (`ERROR` and `MISSING` included), and tree-identical performance work.
  - PATCH: build, tooling and documentation changes, and a CLI-pin move with identical trees.
- The release PR sets the release version in every manifest (`package.json`, `package-lock.json`, `Cargo.toml`,
  `Cargo.lock`, `pyproject.toml`, `CMakeLists.txt`, `common/common.mak`, `tree-sitter.json` `metadata.version`) and
  the latest `CHANGELOG.md` heading (CI job `versions` checks all), and regenerates both `parser.c`, which embed
  `metadata.version`. Fix PRs change none of them.
- Keep the grammar names `typescript` and `tsx` and the C symbols `tree_sitter_typescript` and `tree_sitter_tsx`.
- A fix starts from a failing case (corpus test or oracle case) and cites its evidence. Existing corpus tests keep
  passing unless the change alters them on purpose and says why.
- Keep every copyright line in `LICENSE` and the attribution in `NOTICE` (MIT).
- Agents prepare branches, commits and pull requests. Every merge, tag, release, publication, repository-setting
  change and deletion needs the owner's separate approval. No registry publishing (npm, crates.io, PyPI).
