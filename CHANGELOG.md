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
- A block comment that starts a line before a ternary `?` is kept in the tree, in both grammars: in `a⏎/* c */ ? b : c;`
  the `comment` node was missing (no `ERROR`, no `MISSING`, the comment's bytes simply belonged to no node). The
  external scanner, deciding whether to insert a semicolon after `a`, skipped the comment and then read the `?` as the
  ternary question mark from there. It already refused to do that after a line comment; it now does the same after a
  block comment (`common/scanner.h`; the port of tree-sitter-javascript `e7d9759` in upstream `52f79e4` had kept only
  the line-comment half). `tsc` 7.0.2 accepts these inputs.
  - Node kinds and fields added: none (no generated file changes).
  - Error-free tree changes: inputs of this shape gain the `comment` node they lacked; nothing else in their trees
    changes. Among the pinned example files exactly one has this shape,
    `examples/vscode/src/vs/platform/userDataSync/common/abstractSynchronizer.ts` (line 575), and it gains one
    `comment` node. Queries: `(comment) @comment` (highlights) and the JSDoc injection now also match such comments.
  - `test/examples/known-failures.txt`: no entry cleared (the affected inputs had no error before).
- Automatic semicolon insertion treats every ECMAScript line terminator as a line break, in both grammars, as `tsc`
  does: a lone CR, U+2028, U+2029, and a block comment that holds a line terminator (`/*⏎*/`). Before, the external
  scanner (`common/scanner.h`) looked only for LF, so `a = b /*⏎*/ c = d;`, `x<U+2028>++y;` or
  `class A { static accessor /*⏎*/ x = 1; }` gave `ERROR`, and a line comment ended by U+2028, U+2029 or a lone CR did
  not count as a line break either. Also, after a line break, `in` or `instanceof` followed by `=`, `:`, `?`, `;` or
  `}` where no binary operator may follow now starts the next class or type member (`class A { x⏎in = 1; }`,
  `interface I { a: string⏎in: number }`) instead of giving `ERROR`; `a⏎in b` and `for (var x⏎in y)` are unchanged.
  `tsc` 7.0.2 accepts all these inputs.
  - Node kinds and fields added: none (no generated file changes).
  - Error-free tree changes: an input whose line break has one of these forms now gets the tree the same input gets
    with LF. Where that tree differs from the old one: `return`, `break`, `continue`, `readonly`, `async` (class
    member), `type` and `declare` followed by such a line break end there (`return;` then `x;`, as `tsc` reads them;
    before, `return /*⏎*/ x` returned `x`). `static`, `get` and `set` followed by such a line break now also give two
    members, like the LF form; `tsc` reads one member there (see the known difference below). A
    block comment holding the line break now follows the inserted semicolon (a sibling of the statement or member)
    instead of sitting inside it. Queries follow these trees (for example `@keyword` -> `@property` for `static`, and
    in `set /*⏎*/ x(v) {}` the comment becomes the `@doc` of method `x`). None of the 17,665 pinned example files
    changes its tree.
  - `test/examples/known-failures.txt`: no entry cleared.
  - Known difference kept: `static`, `get` or `set` followed by a line break (any form, LF included) and a member name
    gives two class members (a field named `static`, `get` or `set`, then the member); `tsc` reads one static member
    or accessor. The LF form already did this before this change. Fixing it needs a grammar change; it is a candidate
    after v2.0.0.
  - Known difference kept: `in()` or `in<T>()` as a method name after a line break still gives `ERROR` (the scanner
    cannot tell it from `for (var x⏎in (y))`).
- Automatic semicolon insertion before a word that starts with `in` or `instanceof` after a line break, in both
  grammars, as `tsc` does: `in_progress`, `in1`, `in$`, `instanceof_x`, a word with a non-ASCII or `\u`-escaped
  character after `in` (`in·x`, `in` + U+0301, `ina`). The external scanner (`common/scanner.h`) took such a word for the
  keyword `in` or `instanceof` when the next character was not a letter by the C library's `iswalpha()` (which also
  depends on the platform and locale), and inserted no semicolon: `a = b⏎in_progress = true`, `foo()⏎in1.x()`,
  `class A { x⏎in_y = 1 }` and `interface I { a: string⏎in_b: number }` gave `ERROR`. Now a word continues after `in`
  or `instanceof` on an ASCII letter, digit, `_`, `$` or `\`, or on any non-ASCII character that is not white space
  (the grammar's own identifier characters). Also, the white space between the keyword `in` and a member's `=`, `:`,
  `?`, `;` or `}` is matched by code point, so U+FEFF and U+200B there (`class A { x⏎in<U+FEFF>= 1 }`) no longer give
  `ERROR`. `a⏎in b`, `a⏎instanceof B` and `for (var x⏎in y)` are unchanged. `tsc` 7.0.2 accepts all these inputs.
  - Node kinds and fields added: none (no generated file changes).
  - Error-free tree changes: `return`, `break`, `readonly`, `async` (class member) and `type` followed by
    a line break and such a word now end there, as they already did before any other identifier (`return;` then
    `in_x;`, as `tsc` reads them; before, `return⏎in_x` returned `in_x`). `static` and `get` followed by a line break
    and such a word now give two members, as before any other identifier (the known difference above; `tsc` reads
    one member). Queries follow these trees (for example `@keyword` -> `@property` for `readonly`). None
    of the 17,665 pinned example files changes its tree.
  - `test/examples/known-failures.txt`: no entry cleared.
