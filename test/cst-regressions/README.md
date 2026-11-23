# Historical JavaScript inputs for CST comparisons

Run the fixture loader with Python 3.12 or later from the repository root.
It verifies all source and edit SHA-256s before making the fixtures available to
the CST harness. The cache may be outside the checkout. The loader fetches two
source files by full Git commit and stores them by SHA-256. Use `--offline` to
verify a populated cache without network access.

```powershell
python -B test/cst-regressions/fixtures.py build/cst-regression-inputs
python -B test/cst-regressions/fixtures.py build/cst-regression-inputs --offline
```

The manifest has 364 sequences. It covers 347 TypeScript sequences (1,315
source and edited versions, 968 edit steps) and 364 TSX sequences (1,333 source
and edited versions, 969 edit steps). These include 279 sequences recovered
before the archive cleanup review, 65 newly restored sequences and 20
replacement sequences. Each JSON line has a historical ID. Edits use half-open
UTF-8 byte offsets on the preceding version. The first SHA-256 checks the
source and each following SHA-256 checks one edited version. For included-range
fixtures, `@gap@` marks excluded bytes and `visible_sha256` checks the
concatenated included bytes separately.

| ID prefix | Source |
| --- | --- |
| `76/bench/` | The affected `i43` benchmark inputs recorded for [JavaScript #76](https://github.com/wotjr1649/tree-sitter-javascript/pull/76). |
| `76/probes/` | The Perf2 generated probe matrix reviewed in #76. The deleted archive held `perf2/build/perf2/probes.jsonl`. Byte-verified sources are either inline (`source`) or marked `"generated": true` and rebuilt by `fixtures.py` to bytes that match the recorded SHA-256 (60 entries). Entries with `historical` use the replacement generator below. |
| `76/ranges/class-ranges/` | The Perf2 range generator's `ranges.jsonl` reviewed in #76. The three restored sequences start with `/*a`, `//a` and `<!--a` followed by two excluded intervals. The first edit opens a range between them. |
| `76/`, `79/` focused cases | Scanner reproductions for [#76](https://github.com/wotjr1649/tree-sitter-javascript/pull/76) and [#79](https://github.com/wotjr1649/tree-sitter-javascript/pull/79). |
| `79/case3`, `79/extra-modal-exact-original` | The same Semantic UI React 2.1.5 file, `src/modules/Modal/utils/index.js`, from commit `a32499d7c72b1619044719da621ff7cc926e0eec`. The original edits insert a space at byte 1000 and 978, respectively. |
| `79/extra-generator-exact-original` | The test262 generator expression fixture from commit `2e58f87d8350ad51224617a041c6e041d52f8444`, at `test/built-ins/Function/prototype/toString/generator-function-expression.js`. |
| `80/`, `81/` | Focused cases from [#80](https://github.com/wotjr1649/tree-sitter-javascript/pull/80) and [#81](https://github.com/wotjr1649/tree-sitter-javascript/pull/81). |

The 80 reconstructed probes use
`76/probes/yield/statement/<context>/<newline>/<trivia>/delegate`. The
generator places a line terminator before the delegation star with LF, CR,
CRLF, U+2028 or U+2029 and bare, block, line or chained comment trivia.
The object generator methods, class generator methods and class field
initializers match all historical source and edit hashes. The computed
generator method uses a replacement template for the remaining 20 cases.
Each replacement retains the original hashes and byte edits under
`historical`. Its four-step review schedule inserts a newline block
comment near a scanner marker, removes and restores the adjacent
character, and removes the comment.

The synthetic cases and their checksums are small enough to keep with the
tests. The two external files retain their upstream licenses through the
pinned repositories (MIT for Semantic UI React and BSD-3-Clause for test262).
Caching only the checked files keeps the fixture data available locally after
the first run and avoids copying the third-party archives into this repository.
