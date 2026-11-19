# Changelog

## Unreleased

### Fixed

- `export type * from 'm'`, `export type * as ns from 'm'`, `export type * as default from 'm'` and
  `export type * as "name" from 'm'` parse without error in both grammars (issue #348). Before, both grammars put
  `type` in an `ERROR` node (bytes 7-11) and read the rest as a plain `export *` statement. The `export type *` form reuses the existing `export_statement` shape of `export * from`:
  an anonymous `*` and the `source` field, or a `namespace_export` child and `source`.
  - Node kinds and fields added: none (`node-types.json` unchanged in both grammars).
  - Error-free tree changes: none found (existing corpus inputs and the P112 `exporttype-*` inputs, both grammars).
  - `test/examples/known-failures.txt`: no entry cleared (no listed file uses this form).
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #358 by @gthb, head commit
    `8a43a912d4a941767829a00ff0be80318762a4f1` (grammar hunk and corpus test taken unchanged).
- TSX: a bare `&` in JSX text (`<p>Shipping & Handling</p>`, `<p>&</p>`, `<p>&foo</p>`, `<p>&한글</p>`) is part of the
  `jsx_text` node instead of an `ERROR`. Only a complete character reference still ends the text and becomes an
  `html_character_reference` node, as before; "complete" means the shapes the existing `html_character_reference`
  token accepts (`&name;` with 1 to 30 ASCII letters, `&#` 1 to 5 ASCII digits `;`, `&#x` 1 to 6 ASCII hex digits
  `;`), so `&amp;`, `&#38;` and `&#x26;` are references while `&frac12;` (a digit in the name), `&#123456;` and
  `&#١;` (a non-ASCII digit) are text. The change is in the external scanner (`common/scanner.h`); the generated
  parsers are unchanged, and the typescript grammar is not affected.
  - Node kinds and fields added: none.
  - Error-free tree changes: none found (existing corpus inputs, the P112 JSX inputs and the P105 `&` inputs, both
    grammars).
  - `test/examples/known-failures.txt`: 15 entries cleared (`v1.1: bare & in JSX text`), all under
    `examples/vscode/extensions/copilot/src/extension/prompt{,s}/`. The desktop entry
    `app/test/unit/ui/structural-and-text-components-test.tsx` stays: its `&` is in a JSX attribute string
    (`text="E&xit"`), which this change does not cover.
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #371 by @pmeredit, head commit
    `f8637eb92272dd9c2c69ebc62e5f72c016e0b6b7` (scanner change and corpus test taken unchanged). Ours on top: the
    reference check uses ASCII digit ranges instead of `iswdigit` / `iswxdigit`, which accept other digits on some
    platforms (with MSYS2 gcc on Windows `<p>&#١;</p>` was an `ERROR`), and the corpus test has the non-ASCII digit
    and length-limit inputs.
- In the `tsx` grammar, a `&` in a JSX attribute string that does not start a complete character reference parses
  without error: `<A text="E&xit" />`, `'E&xit'`, `"&#"`, `"&#65"`, `"&ab;cd&ef"`, and a `&` right before the closing
  quote (`"a&"`, `'a&'`). `tsc` 7.0.2 accepts all of these. Before, `&` followed by `#` or an ASCII letter had to start
  an `html_character_reference`, so `"E&xit"` gave `(string (string_fragment) (ERROR (identifier)))`; and a `&` before
  the closing quote took the quote into the `string_fragment`, so the string ran on to the next quote. A complete
  reference (the shapes the existing `html_character_reference` token accepts: an ASCII name of 1-30 letters, `&#` and
  1-5 ASCII digits, `&#x` or `&#X` and 1-6 ASCII hex digits, then `;`) is still an `html_character_reference`; a `&`
  that starts an incomplete reference is now its own `string_fragment` (`"E&xit"` gives three: `E`, `&`, `xit`). The
  JSX text rules and the `typescript` grammar are unchanged (its generated `parser.c` and both `node-types.json` are byte-identical).
  - Node kinds and fields added: none.
  - Error-free tree changes: two kinds of input that parsed without error before this change.
    - Now an error, as intended: a `&` before the closing quote of one attribute string followed by an unterminated
      string, for example `<A t="a&" b="/>;` (before: one string `"a&" b="`; `tsc` reports TS1002, unterminated
      string literal).
    - Still error-free, but the tree is corrected (the same swallowed-attribute defect on valid input):
      `<A t="&" b="/>//"/>;` and `<A t='&' b='/>// '/>;`. Before, the string of `t` swallowed `" b="` (it ran from
      its opening quote to the quote opening `b`'s value), the element closed at the first `/>` (bytes 12-14) and the
      rest was a `comment`. Now `t="&"` and `b="/>//"` are two `jsx_attribute` nodes and the element closes at the
      later `/>` (bytes 17-19; 18-20 in the single-quoted input). Schema: no change. Queries: the JSX `@attribute`
      capture gains `b`, the `@comment` range of the old tree is gone, `@string` follows the two string nodes. `tsc`
      7.0.2 accepts both inputs; both are oracle accept cases (`n3/attr-swallow-regression-double.tsx`,
      `n3/attr-swallow-regression-single.tsx`).
  - `test/examples/known-failures.txt`: `examples/desktop/app/test/unit/ui/structural-and-text-components-test.tsx`
    cleared (`text="E&xit"`).
