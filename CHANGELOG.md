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
- `f<typeof import('m')>(...)`: the type query `typeof import('m')` as the first type argument of a call is read as
  type arguments, not as the binary expression `f < typeof import('m') > (...)` (for example
  `importOriginal<typeof import('vscode')>()`, `f<typeof import('m')>(1, 2)`, `f<typeof import('m').x, string>()`).
  Before, `f<typeof import('m')>()` and `f<typeof import('m')>;` had an `ERROR`, and with arguments the call was
  silently read as two comparisons. `precedences` ordered `call_expression` above `_type_query_call_expression`, which
  resolved the conflict between them statically at `)` followed by `>`; the pair is now a declared `conflicts` entry,
  so both readings stay alive and the one that fits the following tokens wins.
  - Node kinds and fields added: none; `node-types.json` unchanged by this part.
  - Error-free tree changes: 36 of the 17,664 files of the pinned example repositories change their (error-free) tree,
    all in `examples/vscode` and all the same construct, `f<typeof import('m')>(args)` with at least one argument
    (`importAMDNodeModule<typeof import('jschardet')>('jschardet', 'dist/jschardet.min.js')`): the base tree is a chain
    of `binary_expression` (comparison, comparison, a `sequence_expression` of the arguments); the new tree is a
    `call_expression` with `type_arguments` (a `type_query`) and `arguments`, which is what tsc builds. Regression
    input kept: `f<typeof import('vscode')>(1, 2);` in `test/corpus/types.txt`. Queries: `highlights.scm` gains the
    `type_arguments` brackets, and the JavaScript `highlights.scm` and `tags.scm` call patterns now match these calls;
    no query pattern loses a match.
  - `test/examples/known-failures.txt`: 14 entries cleared (`v1.1: typeof import(...) type query as a type argument`).
    `examples/vscode/extensions/copilot/src/extension/chatSessions/copilotcli/node/test/copilotcliSession.spec.ts`
    stays listed: besides `importOriginal<typeof import('../cliHelpers')>()` it uses `import('vscode').ChatResultUsage[]`
    (line 211), which needs the separate fix for an `import(...)` type followed by `[]`; whichever of the two changes is
    merged second removes the entry.
  - Known limit, same at the base: `await f<typeof import('m')>()` is a `call_expression` whose function is the
    `await_expression` (the same shape as `await f<A>()`), a separate upstream quirk this change does not touch.
  - Ours, no upstream pull request.
