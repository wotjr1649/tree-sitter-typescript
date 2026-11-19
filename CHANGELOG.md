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
- The `accessor` modifier composes with `static`, `override`, `abstract` and `readonly` in both grammars
  (issue #369): `static accessor x = 1`, `abstract accessor x: number`, `override accessor x = 1`,
  `static override accessor x = 1`, `@dec static accessor x = 1`, `private static accessor x = 1`. A class member may
  also be named `accessor`: `accessor() {}`, `accessor;`, `accessor = 1`, `accessor: number = 1`. Before, these were
  `ERROR`s. `readonly accessor x` is accepted too (tsc rejects it only in the checker, TS1243). `declare accessor x`
  already parsed before this change and is unchanged.
  - Node kinds and fields added: none (`node-types.json` unchanged in both grammars).
  - Error-free tree change: `accessor` followed by a line break and a member name, `class A { accessor` + newline +
    `x = 1 }`, was one field `x` with the `accessor` modifier; it is now two fields, `accessor` and `x = 1`, as tsc
    reads it (automatic semicolon insertion; tsc emits `accessor;` and `x = 1;`). On such input the JavaScript
    highlights query gains one `@property` capture for `accessor`.
  - Known differences from tsc (recorded, not fixed here):
    - Nine literal/expression inputs that tsc rejects are now accepted after `static accessor`, because the field
      rules already accept the same text without `accessor` (the grammar does not validate literals). Each is one
      file, `class A { static accessor <member> }`, with `<member>` = `012 = 1` (TS1121), `08 = 1` (TS1489),
      `0_1 = 1` (TS6188), `01n = 1` (TS1121, TS1005), `"\8" = 1` (TS1488), `"\1" = 1` (TS1487),
      `"\u{110000}" = 1` (TS1198), `x = 01` (TS1121), `x = (y: number)` (TS1005, `'=>' expected`). Base: `ERROR`;
      now: no error. Control: the same inputs without `accessor` (`class A { static 012 = 1; }` and so on) are
      already accepted at base and now. Validating literals is a later candidate.
    - Automatic semicolon insertion after `accessor` is not complete. When the line break after `static accessor`
      is a newline inside a block comment (`static accessor /*` + newline + `*/ x = 1`), a lone CR, U+2028 or
      U+2029, or when `in` follows the line break, the scanner does not insert the semicolon, so the input is one
      static auto-accessor where tsc reads two fields (`static accessor;` and `x = 1;`). Base: `ERROR`; now: no
      error, wrong tree. A plain LF, CRLF or `//` comment line break gives the same two fields in base, now and tsc.
      Without `static`, the block-comment input was already one field at base. Fixed separately (N5).
  - `test/examples/known-failures.txt`: no entry cleared (no listed file uses these forms).
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #381 by @jhoward321, head commit
    `affacccfb08d6370a488df542de257017f38be28` (grammar hunks and corpus tests taken unchanged; the line-break test is
    ours).
