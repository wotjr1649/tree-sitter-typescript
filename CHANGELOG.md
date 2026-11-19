# Changelog

## Unreleased

### Fixed

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
