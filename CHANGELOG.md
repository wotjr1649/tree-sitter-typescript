# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- Use the grammar, queries and license from `wotjr1649/tree-sitter-javascript` v4.4.0 (tag object `a907252`, commit
  `e5ada30`) as the vendored JavaScript input for both grammars. This replaces upstream JavaScript v0.23.1.
  [Vendor provenance](NOTICE)
- Port the JavaScript external scanner and adapt it to TypeScript signatures and bindings.
  - v4.0.0 tracks the contexts of `await` and `yield`, handles `using` and `await using` at automatic semicolon
    insertion (ASI) boundaries, and scans quoted JSX attribute fragments and references.
  - v4.1.0 shares scanner context entry for ordinary methods and restores shallow scope stacks directly.
  - v4.2.0 adds the ASCII whitespace and zero-lookahead EOF fast paths and distinguishes a literal NUL from EOF.
  - v4.3.0 carries pending ASI and declaration lookahead across incremental reuse of bare declarators and `yield`.
  - v4.4.0 preserves trailing comments after a reused initializer or declarator at EOF and across line breaks.
- Generated `parser.c` sizes against v2.0.0 are 9,403,434 to 11,821,348 bytes for TypeScript (+25.7%) and
  9,432,380 to 12,502,888 bytes for TSX (+32.6%). LR states grow from 6,719 to 10,482 and from 6,851 to 10,996,
  respectively.

### Added

- `using_declaration` is a named `declaration` subtype with `variable_declarator` children and a `kind` field for
  `using` and optional `await`. Parenthesized decorators accept general expressions such as `@(a || b)`. TSX
  permits a hyphen in the first segment of a JSX member tag, including `<a-b.C<T> />`.

### Fixed

- A line break before `[` ends a function or method return type, including a break inside a block comment.
  A same-line `T[K]` or `T[]` remains part of the return type.
- Parse an `await using` declaration across a line break between the keywords when its binding starts on the same
  line as `using`. A call such as `await using()` still parses as an expression.
- Prefer `await_expression` over an ambiguous call in modules and async functions, including `await(this)`.
- Bind type arguments to postfix expressions before comparisons. `1 < foo<string>()` is a comparison whose right
  operand is the generic call. Two pinned VS Code files with `unique` after `<` now parse.
- Keep `default` an `identifier` in named import and export specifiers, including names on either side of `as`.
  Type query member names such as `typeof import('m').default` parse as `property_identifier`.
- Disable Annex B HTML-like comments in TypeScript and TSX. The scanner leaves `<!--` available to the expression
  grammar and inputs such as a bare `-->` line can produce syntax errors.
- Tagged templates, including tags with type arguments, accept `\u` without hex digits. One more pinned VS Code
  file now parses. `test/examples/known-failures.txt` shrinks from 14 entries to 11 across 17,665 files.

### Breaking

- Quoted JSX attribute fragments can split before the closing quote (A1) or merge around incomplete character
  references (A2). Trailing comments can move outside a bare declaration (A3), from an initializer's function body
  to its declaration (A4), or from a preceding statement or body to the enclosing block or program (B8).
- `as` now wraps the `await_expression` in `await f() as T` (B2). Generic calls and their member accesses can move
  inside `await` (N01, N02). Non-null assertions bind to their immediate operand (B6), and prefix operators can wrap
  a generic call and its member access (B7).
- The member object in `@(super.decorate)` is `super` (B9) and the member object in `<this.C/>` is `this` (B10).
  `using` and `await using` declarations now use `using_declaration` (B11). A `hash_bang_line` range ends before
  a terminating CR (H1).
- In both `node-types.json` files, `await_expression`, `non_null_expression` and `instantiation_expression` list
  more specific child types in place of `expression`. `parenthesized_expression` lists those of its children
  covered by `expression` through that supertype, including calls, identifiers and member expressions.
- Full CST comparison against v2.0.0 found 962 changes among 21,747 input–grammar pairs where the input was valid
  and previously parsed without error (896 TypeScript, 66 TSX). See the
  [migration guide](docs/migrating-from-2.0.md) for the CST changes, schema details and query updates.

## [2.0.0] - 2026-11-20

The first release that changes how the grammars parse. 1.0.0 is the upstream `tree-sitter/tree-sitter-typescript`
v0.23.2 grammar regenerated with tree-sitter CLI 0.27.2 (ABI 15) and behaves the same; this repository continues from
it as an independent repository (ADR-0001). 2.0.0 contains the fixes S1-S6, N1-N5, N1b and N7 (one change per defect
class, each checked against `typescript` 7.0.2 `tsc` in the oracle, whose committed cases have no mismatch with tsc).
Breaking: the tree of some input that parsed without error at 1.0.0 is different now (tagged templates with type
arguments, `accessor` followed by a line break, a block comment before a ternary `?`, a `&` before the closing quote of
a TSX attribute string, an index after `as import('x').Y`, `f<typeof import('m')>(x)`, line breaks other than LF in
automatic semicolon insertion, `let` followed by a line break and a binding, a word starting with `in` after a line
break), some invalid inputs that were accepted are errors now (`type D<in> = number;`, `<A t="a&" b="/>;` in TSX,
`a⏎/* c */ +? b : c;`, `let⏎ordinary();`), and some valid inputs are errors now, as a related form already
was at 1.0.0 (a class member named `in` after a lone CR, U+2028, U+2029 or a line-breaking block comment, like after an
LF; `v as import('x').Y` + line break + `[a + b];`, like after any other type); no node kind or field is removed or
renamed. Schema additions: a `type_arguments` child of `member_expression`, the anonymous node `out`,
`type_parameters` children no longer required, `call_expression` and `member_expression` as subtypes of
`primary_type`, `object` and `string` among the children of `arguments`. The Go module path is
`github.com/wotjr1649/tree-sitter-typescript/v2`. See [docs/migrating-from-1.0.md](docs/migrating-from-1.0.md).

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
- An `import(...)` type whose member takes type arguments parses without error in both grammars (issues #322, #352):
  `type Foo = import('foo').Foo<F>`, `let x: import('m').C<string, number>`, `type T = import('m').A.B<string>`.
  Before, the `<...>` part was an `ERROR` (or a `MISSING ";"` followed by a stray type assertion). The type arguments
  are a child of the `member_expression` that the grammar already uses for `import('m').X` in type position, and only
  of the outermost one: type arguments on an inner member or on a callee stay errors, as in tsc (TS1005), e.g.
  `import('m').A<string>.B` and `import('m').A<string>()`.
  - Node kinds and fields added: `member_expression` may now have a `type_arguments` child (no field name), in both
    grammars. No node kind or field removed or renamed.
  - Error-free tree changes: none found (existing corpus inputs and the P112 `importtype-*` inputs, both grammars).
  - `test/examples/known-failures.txt`: 3 entries cleared (`v1.1: import(...) type followed by a member, type
    arguments, index or []`). Not fixed by this change, still listed: an `import(...)` type followed by `[]` or an
    index (`import('x').Y[]`, `import('x').Y['k']`; 8 entries) and `typeof import(...)` as a type argument
    (`importOriginal<typeof import('vscode')>()`; 15 entries).
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #365 by @elecnix, head commit
    `92634edfbf75963f8b47c6740e9e89ee289ae3df` (corpus test taken unchanged; the grammar change starts from its hunk).
  - Ours on top of #365: #365 adds `optional($.type_arguments)` to the recursive member rule, which is also the
    `object` of a member and the `function` of a call, so it accepted `import('m').A<string>.B`,
    `import('m').A<string>.B<number>`, `import('m').A<string>()` and `import('m').A<string>().B<number>`. We put the
    type arguments in a separate rule used only for the outermost member (aliased to the same `member_expression`) and
    drop #365's conflict entry. That rule first wrapped the whole member rule, whose `object` can be a call or a bare
    `import`, so `import('m').A().B<string>`, `import('m').A.B().C<string>` and `import.A<string>` (tsc rejects all
    three) parsed clean. The type arguments now go only on a dot chain that starts at `import(...)`, with no call in
    between and no bare `import`: the member and call rules are split into that chain and the rest (hidden rules, same
    aliases; each of the two conflict entries for the member and call rules is split in two). Trees of the inputs #365 fixes are unchanged.
  - Known differences from tsc (not fixed here): ten inputs that tsc 7.0.2 rejects parse clean in both grammars with this
    change (error at the base). In each case the same defect without type arguments after `import(...)` was already
    accepted at the base (`3061888`, both grammars, tsc rejects it), so this change extends existing leniency to the new
    type-arguments path and adds no new kind of leniency:
    - `import(...)` with invalid arguments followed by a member and type arguments: `type T = import().A<string>;`
      (TS1110), `import('m' + '/sub').A<string>`, `import('m', opts).A<string>`, `import('m', {}, {}).A<string>`,
      `import(getModule()).A<string>`, `import('m', { wrong: {} }).A<string>`, `import('m',).A<string>` (TS1005) and
      `import(...args).A<string>` (TS1110). Base accepts `type T = import().A;`, `import('m' + '/sub').A`, and the same
      six other argument forms without `<string>`.
    - `let x: import('m').A.B` and, on the next line, `<string>;`: tsc reports TS1109 (typescript) and TS17008
      (tsx), because type arguments cannot follow a line break; the grammar attaches `<string>` to the type. Base
      accepts `let x: Foo` + line break + `<string>;` and `let x: a.B` + line break + `<string>;`.
    - `type T = import('m').A<typeof import('n').B().C<string>>;` (TS1005): the call inside the nested `typeof` path.
      Base accepts `type T = typeof import('n').B().C<string>;` and `type T = X<typeof import('n').B().C<string>>;`.
    These stay open for a later change.
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
- A tagged template with type arguments parses as a `call_expression` with `type_arguments` in both grammars
  (issue #341): ``f<T>`x` ``, ``a.b<T>`x` ``, ``sql<{ a: string }>`select` ``, ``f<T[]>`x` ``, ``f<[A, B]>`x` ``,
  ``f<() => void>`x` ``. Object, array, function and tuple-of-type-keyword type arguments (``f<[string, number]>`x` ``) were `ERROR`s
  before; simple ones, including a tuple of identifiers (``f<[A, B]>`x` ``, read as an `array`), were misread without
  error as comparisons, ``(f < T) > `x` ``. A prefix, binary or update operator in front binds to the
  whole tagged template, as in tsc (``await sql<T>`x` `` is `await (sql<T>`x`)`), and calls, instantiation expressions
  and comparisons such as `f<T>(x)`, `a < b > c` and `c ? f<R<S>>(d) : e` keep their trees.
  - Node kinds and fields added: none (`call_expression` already has the `type_arguments` field;
    `node-types.json` unchanged in both grammars).
  - Error-free tree changes (intended, the base trees were misparses): ``f<T>`x` ``, ``a.b<T>`x` ``,
    ``f<A, B>`x` ``, ``f<[A, B]>`x` ``, ``f<Array<T>>`x` ``, ``f<T>`a${b}c` ``, ``a < b > `x` ``, ``a<b>`x`.y``, ``f<T>`x``y` ``,
    ``await sql<T>`x` `` and ``new Foo<T>`x` `` (now `new (Foo<T>`x`)`), and the same forms after `+`, `*`, `typeof`,
    `void`, `delete`, `!`, `-` and `++`, change from `binary_expression` / `sequence_expression` trees to
    `call_expression` + `type_arguments`. tsc reads all of them as tagged templates. Highlight and tag queries match
    accordingly (for example `@function` and `@reference.call` on the tag).
  - `test/examples/known-failures.txt`: no entry cleared.
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #382 by @jhoward321, head commit
    `3517fdf4b0de94c7abc48df803a1118d7286ca4e` (grammar hunks and corpus tests taken unchanged). PR #342 and #350 are
    not used (#350 changes generated files and a corpus test only, and only for typescript).
- Variance annotations on type parameters parse without error in both grammars (issue #370): `interface I<in T>`,
  `type B<out T>`, `class C<in out T>`, `class D<const in T>`, `declare class C<in out T>`,
  `type G<in A, out B>`, `interface Q<out A extends string = 'a'>`. Before, `in`/`out` there was an `ERROR`. The
  modifiers are anonymous tokens before the `name` field of `type_parameter`. A type parameter may still be named
  `out`: `type A<out> = out`, `type B<out = string> = out` and `type C<T, out> = out` keep parsing as before, and `out` stays
  an ordinary identifier elsewhere (`const out = 1; out.x;`, `let x: out;`). `type E<in out> = number` (an `in`
  modifier on a parameter named `out`) was an error before and now parses.
  - tsx: `<in` and `<out` after an expression-start `<` stay JSX tags: `<in />`, `<out />`, `<in y />`,
    `<out in T />`, `<in out>text</in>`, `<out in><in out /></out>` parse as `jsx_self_closing_element` /
    `jsx_element` exactly as before (tsc reads them as JSX). To keep that, an arrow function takes no variance
    modifier on its *first* type parameter in tsx (tsc rejects `<in T,>(x: T) => x` and `<out T,>(x: T) => x` in
    .tsx files too); later parameters keep them (`<T, in U>(x: U) => x`), and `<T,>`, `<T extends X>`, `<out,>`,
    `<out = X>`, `<const T,>` and `async <T,>` parse as before. `typescript` is not affected. This adds the
    hidden rules `_arrow_call_signature`, `_arrow_type_parameters` and `_arrow_type_parameter` (aliased to
    `type_parameters` / `type_parameter`) to the tsx grammar: no visible node kind or field changes.
  - Node kinds and fields added: the anonymous node `out`, in both grammars. No node kind or field removed or renamed.
  - Error-free tree changes: one, in `typescript` only: `const f = async <in>(x: T) => x;` (tsc rejects it, TS1109)
    was an `arrow_function` and is now a `binary_expression` chain. Nothing else among the corpus inputs, the P112
    inputs, the review probes and the 710 `.tsx` example files.
  - Intended new errors (tsc rejects them, TS1359): `type D<in> = number;` and `type L<in, T> = T;` parsed without
    error before and now report an error.
  - Kept as they are, recorded as known differences: `type A<in in T> = T;`, `<out in T>`, `<out out T>` and
    `<in const T>` still report an error, although tsc's parser accepts them (it rejects them only in the checker,
    TS1030 / TS1029); `type E<out extends string> = out;` still parses without error (a parameter named `out` with a
    constraint), although tsc rejects it (TS1359).
  - `test/examples/known-failures.txt`: no entry cleared (no listed file uses variance annotations).
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #364 by @tomerwave, head commit
    `465aa162d077093dc5ad4f46a9463bde6274425e` (grammar hunk and corpus test taken unchanged). Keeping `out` usable
    as a type parameter name (`alias('out', $.type_identifier)` in `name`) is ours; with #364 alone those inputs
    become errors.
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
- A block comment that starts a line before a ternary `?` is kept in the tree, in both grammars: in `a⏎/* c */ ? b : c;`
  the `comment` node was missing (no `ERROR`, no `MISSING`, the comment's bytes simply belonged to no node). The
  external scanner, deciding whether to insert a semicolon after `a`, skipped the comment and then read the `?` as the
  ternary question mark from there. It already refused to do that after a line comment; it now does the same after a
  block comment (`common/scanner.h`; the port of tree-sitter-javascript `e7d9759` in upstream `52f79e4` had kept only
  the line-comment half). `tsc` 7.0.2 accepts these inputs.
  - Node kinds and fields added: none (no generated file changes).
  - Error-free tree changes: valid inputs of this shape gain the `comment` node they lacked; nothing else in their
    trees changes. Among the pinned example files exactly one has this shape,
    `examples/vscode/src/vs/platform/userDataSync/common/abstractSynchronizer.ts` (line 575), and it gains one
    `comment` node (`[574, 5] - [574, 54]`; measured by parsing all 17,665 pinned example files and comparing the full
    CST of the one candidate file the scanner path can reach). Queries:
    `(comment) @comment` (highlights) and the JSDoc injection now also match such comments.
  - Error-flag changes (error-free before, an error now, in both grammars; intended): a block comment before an
    operator that is directly followed by `?`: `a⏎/* c */ +? b : c;` and the same with `-?`, `/?`, `in?` and
    `instanceof?`. At the base the automatic-semicolon check consumed the comment and part of the operator, the
    ternary `?` was then read from there, and the input parsed with exit 0 as a plain ternary expression (comment and
    operator in no node). Now the comment is kept as a `comment` node, the `?` is read normally and the tree has an
    `ERROR` node starting at the `?`. `tsc` 7.0.2 rejects all five inputs (TS1109, first diagnostic at the `?`), so
    the new error is correct.
  - Not changed, recorded: the same shapes without the block comment (`a⏎+? b : c;`, `-?`, `/?`, `in?`,
    `instanceof?`) and with a line comment instead (`a⏎// c⏎+? b : c;` and the others) are rejected by `tsc`
    (TS1109) and accepted by the grammar before and after this change, with the operator in no node. This is an
    older mismatch (the automatic-semicolon check consumes the operator before the ternary `?` is read), left open.
  - `test/examples/known-failures.txt`: no entry cleared (the affected inputs had no error before).
- An `import(...)` type followed by `[]` or an index parses without error in both grammars: `import('x').Y[]`,
  `import('x').Y['k']`, `import('x')['k']`, `import('x')[]`, `import('x').Y<T>[]`, and the same types as operands of
  `readonly`, `keyof`, `?` in a tuple, a conditional type and so on (tsc accepts all of them). Before, the `[...]`
  part was an `ERROR`. The member chain that starts at `import(...)` and the bare `import(...)` (hidden rules from
  S4, aliased to `member_expression` and `call_expression` as before) are now primary types, which is what
  `array_type`, `lookup_type` and `keyof` take; they were only `type`s. The chains with a call or a bare `import`
  (`import('x').A()`, `import.A`) stay `type`s, so `import('x').A()[]` and `import.A[]` stay errors, as in tsc.
  - Node kinds and fields added: none. The `primary_type` supertype lists `call_expression` and `member_expression` as
    subtypes (`node-types.json`, both grammars); `test/node-kinds` is unchanged.
  - Error-free tree change: an `as` or `satisfies` expression whose type is an `import(...)` member chain or a bare
    `import(...)`, followed on the same line by an index: `const x = v as import('x').Y['k'];`,
    `v satisfies import('x')['k']`, `v as import('x').Y[0]`, `v as import('x').Y[a.b]` (tsc 7.0.2 accepts all of them
    and reads the index as part of the type: it erases it from the emit). At the base the index was read as an
    expression: a `subscript_expression` around the `as_expression` (or `satisfies_expression`); now it is a
    `lookup_type` inside the type, as tsc reads it. A consumer that matched `subscript_expression` over an `as`
    expression on such input must match `lookup_type` instead. Same change in both grammars; the oracle record
    `n1/lookup-string` covers `let x: import('x').Y['k']`, the corpus test `Import type with an index after as or
    satisfies, on one line` (and its TSX copy) pins the `as` / `satisfies` form. No query in `queries/` or in the
    inherited JavaScript queries names `subscript_expression`, `lookup_type`, `as_expression` or `array_type`; the
    `string` / `number` index is a `literal_type` around the same `string` / `number` node, so the highlight captures
    on it are unchanged.
  - Same input, index on the next line: `const x = v as import('x').Y` + line break + `[a + b];` (also `satisfies`,
    `[f()]`, `[a?.b]`) is an `ERROR` since this change, a `subscript_expression` at the base; tsc accepts it (a type
    index must start on the same line) and reads two statements. The base already reads every other type the same
    way (`v as Foo` + line break + `[a + b];` is an `ERROR` at the base, and `['k']`, `[0]` or `[a.b]` on the next line is
    silently absorbed into the type), so this change extends that existing limitation to `import(...)` types and
    adds no new kind of difference. Not fixed here; a separate change for all types.
  - `test/examples/known-failures.txt`: 8 entries cleared (`v1.1: import(...) type followed by a member, type
    arguments, index or []`).
  - Not fixed, still errors although tsc accepts them (they were errors at the base too): an `import(...)` member
    type inside parentheses or after `...` in a tuple (`(import('x').Y)[]`, `[...import('x').Y[]]`), `import('x')<T>`, and `f<import('x').B>()`.
  - Not part of this change: `typeof import('m')` as a type argument of a call (`importOriginal<typeof import('vscode')>()`,
    15 `known-failures.txt` entries), a separate cause fixed in its own change. One of those files,
    `examples/vscode/extensions/copilot/src/extension/chatSessions/copilotcli/node/test/copilotcliSession.spec.ts`, also
    uses `import('vscode').ChatResultUsage[]` (line 211): it needs both changes, and whichever is merged second removes
    its entry.
  - Ours, no upstream pull request.
- An empty type parameter list (`type A<> = number;`, `class C<> {}`, `interface I<> {}`, `function f<>() {}`,
  `m<>() {}`, `type F = <>() => void;`) parses without error in both grammars. `tsc` 7.0.2 reports nothing for these
  with `--noCheck` (TS1098 "Type parameter list cannot be empty" is a checker error, and `tsc` does not report it at all
  for type aliases and interfaces). Before, both grammars put a zero-width `type_parameter` holding a `MISSING
  type_identifier` inside `type_parameters`; now `type_parameters` has no children.
  - Node kinds and fields added: none. `node-types.json` in both grammars: the children of `type_parameters` are no
    longer `required` (it may be empty); nothing removed or renamed.
  - Error-free tree changes: none found (existing corpus inputs, the probe inputs, and all 17,664 `.ts`/`.tsx` files
    of the pinned examples, whose trees are byte-identical to the base).
  - `test/examples/known-failures.txt`: no entry cleared (no listed file uses this form).
  - An arrow function still needs a non-empty list: `const g = <>(x) => x;` and `<>() => 1` stay errors in the
    `typescript` grammar, as `tsc` reads `<>` there as a type assertion with no type (TS1110). The arrow function has
    its own signature rule for this; the conflicts `[_call_signature, function_type]` and
    `[_call_signature, constructor_type]` move to it. In `tsx` the arrow function's signature is the one the variance
    entry above defines (`_arrow_type_parameters`: a first parameter without a variance modifier, then any number,
    so the list is non-empty there too); only `typescript` uses `_nonempty_type_parameters`.
  - Error trees only: with an empty list allowed, error recovery for a variance modifier alone changes, e.g.
    `type D<in> = number;` (tsc TS1359 at 7) now gives `type_parameters` holding an `ERROR` that is exactly the `in`
    token `[7,9)`, where it was a `type_parameter` with a `MISSING type_identifier` at 9. The four oracle cases for
    these (`s1/neg-in-alone.*`, `s1/p112-variance-in-alone.*`) are re-registered with `errorAt` 7, `7-9:ERROR`.
  - Known difference: an empty type argument list (`f<>(x)`, `new C<>()`, `let x: A<>;`), which `tsc` also accepts
    with `--noCheck` (TS1099 is a checker error), still gives an error; it is not part of this release.
- `f<typeof import('m')>(...)`: the type query `typeof import('m')` as the first type argument of a call is read as
  type arguments, not as the binary expression `f < typeof import('m') > (...)` (for example
  `importOriginal<typeof import('vscode')>()`, `f<typeof import('m')>(1, 2)`, `f<typeof import('m').x, string>()`).
  Before, `f<typeof import('m')>()` and `f<typeof import('m')>;` had an `ERROR`, and with arguments the call was
  silently read as two comparisons. `precedences` ordered `call_expression` above `_type_query_call_expression`, which
  resolved the conflict between them statically at `)` followed by `>`; the pair is now a declared `conflicts` entry,
  so both readings stay alive and the one that fits the following tokens wins.
  The type query call `import('m')` or `import('m', { with: ... })` (a string literal and an optional object, no trailing
  comma: the hidden rule `_type_query_import_arguments`, aliased to `arguments`) also carries dynamic precedence 1: with
  the tagged-template change merged, the plain call has dynamic precedence 2, so in `f<typeof import('m')>(1, 2)` the
  comparison reading (which holds the call `import('m')`) tied with the call reading and won. The precedence is only on
  that production, not on every type query call, and the argument is a string, as in tsc's import type:
  ``sql<A, typeof f(x)>`text` `` (also `typeof obj.f(x)`, `typeof obj?.f(x)`), `f<typeof import('m', 'n')>(1)`,
  `f<typeof import(...m)>(1)`, `f<typeof import(g(x))>(1)`, `f<typeof import('m' + suffix)>(1, 2)` and
  `f<typeof import(x ? 'm' : 'n')>(1, 2)` stay comparisons, as for tsc (no error either way, only the tree differs).
  `f<typeof import('vscode', { with: { 'resolution-mode': 'import' } })>(1, 2)` is a call, as for tsc.
  - Node kinds and fields added: none. Child types added: `arguments` lists `object` and `string` among its children in
    `node-types.json` (both grammars; no kind or field is added, removed or renamed, and `test/node-kinds` is unchanged).
  - Error-free tree changes: 36 of the 17,665 files of the pinned example repositories change their (error-free) tree,
    all in `examples/vscode` and all the same construct, `f<typeof import('m')>(args)` with at least one argument
    (`importAMDNodeModule<typeof import('jschardet')>('jschardet', 'dist/jschardet.min.js')`): the base tree is a chain
    of `binary_expression` (comparison, comparison, a `sequence_expression` of the arguments); the new tree is a
    `call_expression` with `type_arguments` (a `type_query`) and `arguments`, which is what tsc builds. Regression
    input kept: `f<typeof import('vscode')>(1, 2);` in `test/corpus/types.txt`. Queries: `highlights.scm` gains the
    `type_arguments` brackets, and the JavaScript `highlights.scm` and `tags.scm` call patterns now match these calls;
    no query pattern loses a match.
  - `test/examples/known-failures.txt`: 15 entries cleared (`v1.1: typeof import(...) type query as a type argument`),
    14 left. One of the 15, `examples/vscode/extensions/copilot/src/extension/chatSessions/copilotcli/node/test/copilotcliSession.spec.ts`,
    also uses `import('vscode').ChatResultUsage[]` (line 211) and needed the `import(...)` followed by `[]` change,
    which is already in main; it parses and is no longer listed.
  - Remaining differences from tsc: an import type argument other than a string literal (`f<typeof import(m)>(1, 2)`,
    `import({ a: 'm' })`, `import(42)` and similar) is a call for tsc and a comparison chain here, as at the base;
    ``sql<typeof import('m')>`text` `` (one type argument) is a comparison here and at the base, a tagged template for
    tsc; `f<typeof import('m',)>(1, 2)` (TS1005) and `f<typeof import()>(1)` (TS1110) are comparisons without an error,
    as at the base. New with this change: the second argument is any `object`, so `f<typeof import('m', { x: 1 })>(1, 2)`
    (a comparison for tsc, which wants `{ with: ... }`) and `f<typeof import('m', {})>(1, 2)` (TS1005) are calls without
    an error here, comparisons at the base.
  - `f < typeof import('m') > +x;` (two comparisons and a unary `+` for tsc) keeps its base tree, nested
    `binary_expression`s: the comparison reading wins there, so this change leaves it alone.
  - Known limit, same at the base: `await f<typeof import('m')>()` is a `call_expression` whose function is the
    `await_expression` (the same shape as `await f<A>()`), a separate upstream quirk this change does not touch.
  - Ours, no upstream pull request.
- Automatic semicolon insertion treats every ECMAScript line terminator as a line break, in both grammars, as `tsc`
  does: a lone CR, U+2028, U+2029, and a block comment that holds a line terminator (`/*⏎*/`). Before, the external
  scanner (`common/scanner.h`) looked only for LF, so `a = b /*⏎*/ c = d;`, `x<U+2028>++y;` or
  `class A { static accessor /*⏎*/ x = 1; }` gave `ERROR`, and a line comment ended by U+2028, U+2029 or a lone CR did
  not count as a line break either (the scanner read on to the next LF). The rule is that each of these acts exactly
  as LF does at `e56ad86`: the scanner makes the same decision after it as it makes after an LF, and what an LF does
  there, they do. This includes `in` and `instanceof` after a line break: that path is the one of `e56ad86` (no lookahead
  past the keyword), so `class A { a⏎in() {} }` is `ERROR` after an LF, a CR, U+2028, U+2029 and a line-breaking block
  comment alike, and `for (var x⏎in y)` keeps its `in`.
  Two additions apply to LF too (inputs `tsc` accepts and that were `ERROR` at `e56ad86`): `}` after a line break gets the
  `}:` object-pattern guard it has on one line (`type F = ({ a⏎}: { a: number }) => number;` keeps its object
  pattern), and `with` followed by `{` after a line break is not preceded by a semicolon (`import x from "x"⏎with {
  type: "json" };`; a `with` statement always has `(`, and a comment between `with` and `{` is not skipped, as for LF).
  `tsc` 7.0.2 accepts all these inputs. The paths this change adds (line terminators, the `}` guard, `with`) and the
  existing same-line `}` check classify white space and word characters by code point (the grammar's extras; U+0085 is
  an identifier character there, as in the lexer), not through the C library (`iswspace()` at `e56ad86`); the
  `in`/`instanceof` path is the one of `e56ad86`. The same-line `}` check changes with no line break at all (kept
  on purpose, so that the result does not depend on the C library): `type F = ({ a }<U+FEFF>: { a: number }) => number;`
  and the same with U+200B, which `tsc` accepts,
  were `ERROR` at `e56ad86` and now keep their object pattern; with U+2060, which `tsc` rejects (TS1127), the input
  now parses too, the leniency `e56ad86` already has for `type F = ({}<U+2060>: {}) => number;` (recorded as a known difference).
  Comment scanning in one call: a block comment that holds no line terminator and comes before any line break is left
  to the lexer at once, and so is a second comment that holds one. After a first comment that holds a line terminator,
  the comments without one that follow are all read in the same call, up to the next token or the second
  line-breaking comment: one call over `x/*⏎*/` + N × `/*c*/` + `y;` skips 10/18/34/66 slashes for N=4/8/16/32
  (`e56ad86`: none). That is the cost of one call, not of the whole parse. Over a whole parse a run of N comments
  without a line terminator (`x/*c*/…;`), or of adjacent comments that hold one, costs O(N), not O(N²). A run of
  comments that each start on a line after a line break (`x⏎/*c*/⏎/*c*/…;`) is still rescanned per comment, as at the
  base (N=4/8/16/32: 20/72/272/1056 slash skips in base and now).
  - Node kinds and fields added: none (no generated file changes).
  - Error-free tree changes. An input whose line break has one of these forms now gets the tree the same input gets
    with LF; queries follow the trees. Where that tree differs from the old one (`⏎` here is a block comment holding a
    line terminator, a lone CR, U+2028 or U+2029):
    - Toward `tsc` (it reads two statements or two members):
      - `return`, `break`, `continue` + `⏎` + operand or label: `return /*⏎*/ x` was `return x`, now `return;` then
        `x;` (also `[x]`, `(x)`, `{x: 1}`, a tagged template, a ternary, and inside an arrow function or a JSX
        expression). A label becomes an expression (`@variable`, `local.reference`).
      - `yield` + `⏎` + `x`: one `yield_expression` with an operand, now `yield` then `x;`.
      - `type` + `⏎` + `A = number;`: a type alias, now `type;` then an assignment. `declare` + `⏎` +
        `const a: T;`: an `ambient_declaration`, now `declare;` then the declaration. `async` + `⏎` +
        `function f() {}`: an async function, now `async;` then the function. The keyword gets `@variable` instead of
        `@keyword`.
      - Class members: `readonly`, `accessor`, `public`, `private`, `protected`, `declare`, `override` or `async` +
        `⏎` + member: one member with that modifier, now a field named by the keyword and then the member (the
        modifier node, such as `accessibility_modifier` or `override_modifier`, goes away). The keyword gets
        `@property` (JavaScript highlights) instead of `@keyword` (TypeScript highlights); for `async`/`override` +
        method the `definition.method` tag and `local.scope` start at the method name.
      - `type T = A ⏎ [B];`: a `lookup_type`, now `type T = A;` then the array `[B]`.
    - Same as the LF form, which `tsc` reads differently (recorded known differences, unchanged for LF):
      - `static`, `get`, `set` + `⏎` + member: one static member or accessor, now two members (a field named
        `static`, `get` or `set`, then the member); `tsc` reads one member (recorded as a known difference). `@keyword` ->
        `@property`; in `set /*⏎*/ x(v) {}` the comment becomes the `@doc` of method `x`.
    - A line comment ended by U+2028, U+2029 or a lone CR after an LF (`a⏎// c<U+2028>…`): before, the scanner read
      the comment on to the next LF and decided there. Now the text after the comment decides, as with LF:
      `a⏎// c<U+2028>+b`, `-b`, `(b)`, `[b]`, `` `x` ``, `<T>(x)` and `function f(): U⏎// c<U+2028>{ … }`
      continue the expression or declaration (as `tsc` reads them; before, two statements or a `function_signature` and a block;
      the callee or tag now gets `@function`, and `function f` its `definition.function` from the JavaScript tags).
      `return⏎// c<U+2028>+x`, `return⏎// c<U+2028>/r/.test(s)`, `yield⏎// c<U+2028>(x)` and
      `yield⏎// c<U+2028>/r/.test(s)` now attach the operand and `class A { async⏎// c<U+2028>*x() {} }` is one
      async generator method, as their LF forms; `tsc` splits all five. `const f = async⏎// c<U+2028>(x) => x;` is
      an async arrow function, as its LF form; `tsc` rejects it (TS1005).
    - Unchanged, as their LF forms: `return /*⏎*/ +x`, `return /*⏎*/ /r/.test(s)`, `yield /*⏎*/ (x)` keep the
      operand; `tsc` splits them.
    - Comment placement: a block comment that holds the line break now follows the inserted semicolon (a sibling of
      the statement or member) instead of sitting inside it; a line comment after such a comment likewise
      (`a /* a␍*/ /* c */<U+2029>/* d */ ⏎// line<U+2028>b;`).
    None of the 17,665 pinned example files changes its tree (compared with `e56ad86`).
  - `test/examples/known-failures.txt`: no entry cleared.
  - Known difference kept: `static`, `get` or `set` followed by a line break (any form, LF included) and a member name
    gives two class members (a field named `static`, `get` or `set`, then the member); `tsc` reads one static member
    or accessor. The LF form already did this before this change. Fixing it needs a grammar change; it is a candidate
    after v2.0.0.
  - Known differences recorded: an input whose line break is a CR, U+2028, U+2029 or a
    line-breaking block comment, that `tsc` accepts and that parsed at `e56ad86` only because the old scanner did not
    see the break, now gives `ERROR` where its LF form already gives `ERROR` at `e56ad86` (the scanner cannot tell
    these from inputs that must keep going); fixing them needs a grammar change, a candidate after v2.0.0.
    - A class or type member named `in`, `instanceof`, or starting with them (`in1`, `in_`, `in$`), after a line break:
      `class A { a⏎in = 1; }`, `class A { a⏎in() {} }`, `class A { a⏎in<T>() {} }`,
      `interface I { a: string⏎in(): void }`. `tsc` reads a member; the LF form is `ERROR` at `e56ad86`, and so is every
      other line-break form now. Only a field or method of this name after a line break is affected; the same
      member after `;` or on one line is not.
    - `import x from "m"<CR>with /* c */ { type: "json" };` (a comment between `with` and `{`), and the same after
      U+2028, U+2029 or a line comment: the LF form is `ERROR` at `e56ad86`, so the comment is not skipped.
    - `interface A { a: T⏎// c<U+2028><B>(b: B): V; }` (a call signature starting with `<` on a new line: the known
      `candidate:` gap in `known-failures.txt`) and `a as T⏎// c<U+2028>[b + c];` (a type takes no `[` after a line break).
    - Counts, over the 5,938 inputs of the reviews and the oracle that contain a CR, U+2028, U+2029 or a line-breaking
      block comment (both grammars; `tsc` accepts, `ERROR` here, `ERROR` for the LF form at `e56ad86`): 1,080, of which
      `e56ad86` parses the input itself without error in 170 (a CR, U+2028 or U+2029 it did not see as a line break, or a
      line comment it read past U+2028). By shape: `in`/`instanceof` member 952, `with` comment 24, `as T⏎[` 26,
      interface `<B>(` 26, a comment between `}` and `:` of a typed object pattern 26 (`ERROR` at `e56ad86` also with a
      same-line comment) and `for (using a⏎of b)` 26 (`ERROR` at `e56ad86` also with an LF).
  - Known leniency (inputs `tsc` rejects that now parse, each the same defect `e56ad86` already has for the LF form or,
    for the U+2060 case, for the empty pattern): `yield` then `*x` on the next line, a ternary after `/?` that loses its
    `/` (also on one line: `a /? b : c;`, as `e56ad86` reads `a⏎/? b : c;`), a missing required `;` in a `for` header,
    an automatic semicolon after a Flow-style ambient module type annotation, `with /* c */ (y) {}` after a lone CR, a
    `for`-`in` whose right side holds `<div>{else}</div>` (`for (var x⏎// c<U+2028>in (<div>{else}</div>)) {}`), and
    `type F = ({ a }<U+2060>: { a: number }) => number;`.
- Automatic semicolon insertion before a word that starts with `in` or `instanceof` after a line break where a binary
  operator may follow, in both grammars, as `tsc` does: `a = b⏎in_progress = true`, `foo()⏎in1.x()` and `c =
  d⏎instanceof$ = 2` gave `ERROR`. The external scanner (`common/scanner.h`) took such a word for the keyword `in` or
  `instanceof` when the character after it was not a letter by the C library's `iswalpha()` (which also depends on the
  platform and locale). Now the word goes on after `in` or `instanceof` on an ASCII letter, digit, `_`, `$` or `\`, or
  on any non-ASCII character that is not in the grammar's extras (the grammar's own identifier characters). `a⏎in b`,
  `a⏎instanceof B`, `for (var x⏎in y)` and `let⏎in b` are unchanged: `in` and `instanceof` themselves read as at
  `e56ad86` (no lookahead past the keyword). This also covers class and type members: `class A { x⏎in_y = 1; }`,
  `class A { x⏎instanceof1: number }` and `interface I { a: string⏎in_b: number }` are members now. The N5 known
  difference above (a member named `in`, `instanceof` or starting with them, `in1`, `in_`, `in$`, after a line break
  gives `ERROR`) therefore holds only for a member named `in` or `instanceof` itself. `tsc` 7.0.2 accepts all these
  inputs.
  - After `let` and a line break (LF, CR, CRLF, U+2028, U+2029, or a block comment holding one), a word that is not
    reserved, or `{` (an object pattern), continues the declaration, in both grammars, as `tsc` and the specification
    read it: `let⏎ordinary: number[] = [];`, `let⏎ordinary!: number;`, `let⏎ordinary: Record<string, number> = {};`,
    `let⏎await` and `async function g() { let⏎await }` gave `ERROR` (`let` then a label or an `await`), and `let⏎x =
    1;`, `let⏎x, y;` gave two statements (below). `let⏎{ x } = obj;`, `let⏎{ x }: { x: number } = obj;`, `let⏎{ x } =
    o, y = 1;` and `let // c⏎{ x } = obj;`, also in a function, a block, a `case`, after `if (a)` or a label, gave
    `ERROR` (`let;`, a block, then `=`): with LF or CRLF already at `e56ad86`, and with CR, U+2028, U+2029 or a block
    comment holding a line break since N5 (above; `e56ad86` read those as one line). The scanner reads the word and
    inserts no semicolon unless it is a reserved word: the words `tsc --noCheck` rejects as a binding here (`break` ...
    `with`, its keywords up to `LastReservedWord`), plus `as` and `satisfies`, kept for compatibility (`tsc` takes them
    as the binding, but the grammar cannot: `let as = 1;` errors on one line). A reserved word reads as before:
    `let⏎if (x) {}`, `let⏎return` and `let⏎enum E {}` start a statement, `let⏎in b` and `let⏎instanceof C` are binary
    expressions. Before `{` it inserts no semicolon either. `let⏎(x)` and `let⏎[a] = b` are unchanged, and so is
    `const` (`const⏎x = 1;` and `const⏎{ x } = obj;` were one declaration already). Where `let` is only an
    expression, a block after it stays a block: `x = let⏎{}`, `function f() { return let⏎{} }`; so do `let;⏎{ x }`
    and `let:⏎{}`. For this, `lexical_declaration` takes an
    optional hidden external token `_lexical_declaration_binding` after its `let` or `const`; the scanner never produces
    it, its validity only tells the scanner that it stands right after `let`, where `let` alone could also end a
    statement (not during error recovery, where every token is valid).
  - Node kinds and fields added: none. `grammar.json` and `parser.c` change (the hidden external token);
    `node-types.json` does not.
  - Error-free tree changes, toward `tsc`:
    - `let` + line break + a word that is not reserved: `let⏎x = 1;`, `let⏎x, y;`, `let⏎ordinary = 1,⏎other = 2;`,
      `let⏎inx = 1;`, `let⏎ina = 4;`, `let⏎$x = 1;`, `let⏎type = 1;`, `let⏎of = 1;`, `let⏎yield`, `let⏎let`, and the
      words with a non-ASCII character such as `let⏎inφ = 1;`, `let⏎iné = 1;`, `let⏎instanceofφ = 0;`, `let⏎φ = 1;`,
      `let⏎한 = 1;`, also inside a block or a function: the identifier `let` as an expression statement (`let;`) then a
      second statement (an assignment, a sequence, `yield`), now one `lexical_declaration` (`tsc` emit: `let x = 1;`,
      `let inφ = 1;`). Queries: in the bundled JavaScript queries `let` goes from `@variable` and `local.reference` to
      `@keyword`, and the binding gains `local.definition` (it keeps `@variable` and `local.reference`); the own queries
      and `tags.scm` capture nothing different.
    - `function* g() { let⏎yield }`: `let;` then a `yield_expression`, now `let yield` (`tsc` does the same; the binding
      `yield` in a generator is the binder's error, which `--noCheck` drops). `yield`: `@keyword` -> `@variable`, and it
      gains `local.definition` and `local.reference`; `let` as in the item above.
    - `let` + line break + `{`: `let⏎{ a: b, ...c } = d;` and `let⏎{⏎  a: { b },⏎} = o;` (`let;` then an assignment to
      an object pattern), `let⏎{ x }`, `let⏎{ x };`, `let⏎{}` and `let⏎{ l: x }` (`let;` then a block, or an object),
      now one `lexical_declaration` with an `object_pattern` (`tsc` emit: `let { a: b, ...c } = d;`, `let {};`, `let {
      l: x };`; a missing initializer is the checker's error, which `--noCheck` drops). Queries: in the bundled
      JavaScript queries `let` goes from `@variable` and `local.reference` to `@keyword`, the block's `local.scope` is
      gone, and `x` in `{ l: x }` gains `local.definition`; the own queries and `tags.scm` capture nothing different.
      With CR, U+2028, U+2029 or a block comment, `e56ad86` already read these as one declaration; N5 made them two
      statements, and they are one again.
    - Words after `in`/`instanceof` that go on with `_`, a digit, `$` or `\` (`let⏎in_x = 1;`, `let⏎in1 = 1;`,
      `let⏎instanceof_x, y;`) continued the declaration before N7 too (the old `iswalpha()` path); their trees do not
      change. The non-ASCII ones (`let⏎inφ`, `let⏎iné`, `let⏎instanceofφ`) are in the item above.
    - Not `let`: as before any other identifier (`ordinary`), `tsc` reads two statements:
      - `yield⏎in_x`: a `yield_expression` with the operand `in_x`, now `yield` then the statement `in_x;`. No query
        capture changes.
      - `type⏎in_x = number;`: a `type_alias_declaration`, now `type;` then an assignment. `type` loses `@keyword`,
        `in_x` `@type` and `number` `@type.builtin` (own highlights); all three get `@variable` and `local.reference`.
      - `async⏎in_x => in_x` and `const f = async⏎in_x => in_x;`: an async arrow function, now the identifier `async` (a
        statement, or the initializer of `f`) then an arrow function. `async`: `@keyword` -> `@variable` and
        `local.reference`; `local.scope` starts at the arrow function; `f` loses `@function` and its
        `definition.function` tag.
    - After a line break, a word that starts with `in`/`instanceof` (`in_x`) no longer joins the member or statement
      before it. Against main `d4c5286` (the reduced N5, which has no lookahead past the keyword) these trees change;
      `tsc` 7.0.2 accepts all of them and reads them as the head does, except `set`:
      - `while (true) { continue⏎in_x; }`: main a `continue_statement` with the label `in_x`, now `continue;` then the
        statement `in_x;` (`tsc` emit: `continue;` and `in_x;`). `in_x` gains `@variable` and `local.reference`.
      - `public`, `private`, `protected`, `declare` or `override` + `⏎in_x = 1` in a class (`class C { private⏎in_x = 1 }`):
        main one field with the modifier (`declare`: one field), now a field named by the keyword (`private;`) then the
        field `in_x = 1;` (`tsc` emit: `private;` and `in_x = 1;`). `@keyword` -> `@property` (bundled JavaScript queries).
      - `readonly⏎in_x: number` in an interface: main one readonly property, now two properties (`tsc` emit: `readonly;`
        and `in_x: number;`). `@keyword` -> `@property`.
      - `set⏎in_x(v) {}` in a class: main a setter (a `method_definition`), now a field `set` then a method `in_x`; `tsc`
        keeps the setter (`set in_x(v) {}`), so this one moves away from `tsc`, as `static` and `get`: the known
        difference above, which main already has for `set⏎ordinary(v) {}`. Queries: `set` goes from
        `@keyword` to `@property` (bundled JavaScript queries), and `local.scope` and `definition.method` start at `in_x`
        instead of at `set`.
      N5 at `5226028` (before its reduction) already gave the head trees for these; this entry compares with `d4c5286`.
    None of the 17,665 pinned example files changes its tree (S-expressions with ranges, against `main` `d4c5286`).
  - Now `ERROR`, as `tsc` rejects them (they parsed without error): a non-reserved word after `let⏎` that the old
    reading made a new statement: `let⏎ordinary();`, `let⏎ordinary.x = 1;`, `let⏎ordinary[0] = 1;`, `let⏎ordinary =>
    ordinary;`, `let⏎ordinary: while (1) {}`, `let⏎type T = number;`, `let⏎async function f() {}`, `let⏎declare const x
    = 1;`, `let⏎namespace N {}`, `let⏎module M {}`, `let⏎abstract class C {}`, `let⏎interface I {}`. `tsc` reads `let
    ordinary` (`let type` ...) and then expects `,` (TS1005).
    Likewise a block after `let⏎` that is no object pattern: `let⏎{ foo() }`, `let⏎{ x = 1; }` (`tsc`: TS1005).
  - Newly accepted inputs that `tsc` rejects (the grammar's identifier token takes any non-space character): after `a =
    b` and a line break, `in💩 = 1;`, `in\u0021 = 1;` and `in\u0073tanceof = 1;` (as written in the source, with the
    backslash) gave `ERROR` and now parse; `tsc` rejects all three. The same inputs with a word that does not start with
    `in` (`ix💩`, `ix\u0021`, `i\u006estanceof`) already parsed, so this is a lookalike of existing over-acceptance,
    recorded as a known difference.
  - Known difference (pre-existing): U+0085 (NEL) is white space for `tsc` but not in the grammar's extras: the lexer
    reads it as an identifier character, and the scanner follows the lexer (it tests code points, not the C library). So
    `class C { x⏎in<U+0085>=1 }` is a field named `in<U+0085>` (`tsc`: a field `in`), and `a⏎in<U+0085> b;` gives
    `ERROR` (`tsc` accepts it), as before. (The C library differs too: on the review host `iswspace(0x85)` returned 8 in
    `ucrtbase.dll` and 0 in `msvcrt.dll`.)
  - `test/examples/known-failures.txt`: no entry cleared.
