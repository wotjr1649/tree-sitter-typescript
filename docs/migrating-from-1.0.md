# Moving from 1.0.0 to 2.0.0

> **Release-PR note (remove before merging the release PR).** Built on 2026-11-19 from `main` = `fdd6dd2`. Merged:
> #3 (S2), #4 (S6), #5 (S4), #6 (S3), #7 (S5), #9 (S1), #10 (N3), #11 (N2). Not merged, marked **[pending]** below:
> #13 (N1), #14 (N1b), #12 (N4), #15 (N5) and N7 (no pull request yet). Every **[pending]** item is taken from its pull
> request's description and changes if the pull request changes; complete it when that pull request merges. Counts are
> from the pull request that carries them, measured against its own base, not against `v1.0.0` (`59fc4ed`) directly:
> replace this note by one measurement of the final `main` against `v1.0.0` (corpus, oracle sources and the pinned
> examples, deduplicated), as mssql's guide does.

2.0.0 is the first release that changes how the grammars parse. 1.0.0 is the upstream v0.23.2 grammar regenerated with
CLI 0.27.2 (`tree-sitter/tree-sitter-typescript` `f975a62`, see ADR-0001), with identical behaviour. Versions follow
SemVer from here (ADR-0001 amendment): this is a MAJOR release because the tree of some input that parsed without
error at 1.0.0 is different now. A query or a tree walker written against the old tree of those forms can stop
matching. Nothing is removed or renamed: no node kind and no field.

## Schema (`node-types.json`)

Nothing removed, nothing renamed. Added or relaxed, in both grammars unless noted:

| change | from | note |
| --- | --- | --- |
| `member_expression` may have a `type_arguments` child (no field name) | S4, #5 | `import('m').X<T>` in type position |
| anonymous node `out` | S1, #9 | variance modifier; a parameter named `out` is still a `type_identifier`. `in` was an anonymous node already. |
| the `children` of `type_parameters` go from `required: true` to `required: false` | N4, #12 **[pending]** | `type A<> = number;`; a relaxation, nothing removed. A consumer that trusts `required` must allow an empty list. |
| the `primary_type` supertype lists `call_expression` and `member_expression` as subtypes | N1, #13 **[pending]** | `import('x').Y[]`; the trees of existing input do not change |

No new node kind, no new field name. `test/node-kinds/{typescript,tsx}.txt` (the snapshot) gains the line `"out"`
(S1) and nothing else.

## Trees that change for previously error-free input

This is why the version is 2.0.0. Each row is an input that parsed without error before and still does with a
different tree.

### Tagged templates with type arguments (S5, #7)

`` f<T>`x` `` was read as a comparison chain; tsc reads a tagged template with type arguments (the emit of
``f<T>`x` `` is ``f `x` ``). Now it is a `call_expression` with `type_arguments`. 14 inputs change, identically in
both grammars; the 112 existing corpus inputs do not.

| input | 1.0.0 | 2.0.0 |
| --- | --- | --- |
| ``f<T>`x` ``, ``f<T>`a${b}c` ``, ``a < b > `x` `` | `binary_expression(binary_expression(f, T), template_string)` | `call_expression(function: f, type_arguments, arguments: template_string)` |
| ``a.b<T>`x` `` | comparison around `member_expression` | `call_expression(function: member_expression, type_arguments, template_string)` |
| ``f<A, B>`x` `` | `sequence_expression` of two comparisons | `call_expression` with two type arguments |
| ``f<Array<T>>`x` `` | three nested comparisons | `call_expression` with a `generic_type` argument |
| ``a<b>`x`.y`` | comparison with `member_expression(template_string)` | `member_expression(object: call_expression)` |
| ``f<T>`x``y` `` | comparison with `call_expression(template, template)` | `call_expression(call_expression(f<T>`x`), template)` |
| ``await sql<T>`x` `` | `await_expression` inside a comparison | `await_expression(call_expression)` |
| ``a + b<c>`x` ``, ``a * b<c>`x` `` | operator inside a comparison | `binary_expression(a, call_expression)` |
| ``typeof``/``void``/``delete``/``!``/``-``/``++`` before ``a<b>`x` `` | unary or update inside a comparison | `unary_expression`/`update_expression` around `call_expression` |
| ``new Foo<T>`x` `` | `call_expression(new_expression(Foo<T>), template)` | `new_expression(constructor: call_expression(Foo<T>`x`))` |

Object, array, tuple and function type arguments (``sql<{ a: string }>`select` ``, ``f<T[]>`x` ``) were `ERROR`s and
now parse (error to ok). `f<T>(x)`, `a < b > c`, `a?.b<T>(c)` and `c ? f<R<S>>(d) : e` keep their trees. Queries: the
vendored JavaScript `highlights.scm` captures the tag as `@function` and no longer captures the type argument as
`@variable`/`@constructor`; `tags.scm` gains `@reference.call`; for ``new Foo<T>`x` `` the `@reference.class` capture
of `queries/tags.scm` goes away. The CHANGELOG entry lists one more error-free tree change found in review,
``f<[A, B]>`x` ``.

### `accessor` followed by a line break (S3, #6)

`class A { accessor` + newline + `x = 1 }`
- 1.0.0: one field `x` with the `accessor` modifier.
- 2.0.0: two fields, `accessor` and `x = 1`, as tsc reads it (automatic semicolon insertion). The JavaScript highlights
  query gains one `@property` capture for `accessor`.

`static accessor x = 1`, `abstract accessor x`, `override accessor x`, `@dec static accessor x = 1` and a member named
`accessor` (`accessor() {}`, `accessor;`) were `ERROR`s and parse now.

### `async <in>(x: T) => x` in `typescript` (S1, #9)

`const f = async <in>(x: T) => x;` (tsc rejects it, TS1109) was an `arrow_function` and is now a `binary_expression`
chain, because `in` before a type parameter is now a variance modifier. `typescript` only; nothing else among the
corpus inputs, the oracle inputs and the 710 `.tsx` example files.

### A `&` before the closing quote of a TSX attribute string (N3, #10)

`<A t="&" b="/>//"/>;` and `<A t='&' b='/>// '/>;` (tsx, valid, tsc accepts both):
- 1.0.0: the string of `t` ran on to the quote opening `b`'s value, the element closed at the first `/>` (bytes 12-14)
  and the rest was a `comment`.
- 2.0.0: `t="&"` and `b="/>//"` are two `jsx_attribute` nodes and the element closes at the later `/>` (bytes 17-19;
  18-20 in the single-quoted input).

Queries: the JSX `@attribute` capture gains `b`, the `@comment` range of the old tree is gone, `@string` follows the
two string nodes. A `&` that starts no complete character reference is now its own `string_fragment` (`"E&xit"` gives
three: `E`, `&`, `xit`; it was an `ERROR` before).

### `f<typeof import('m')>(args)` (N1b, #14) **[pending]**

36 of the 17,664 `.ts`/`.tsx` files of the pinned examples change (all in `examples/vscode`), all the same construct:
`importAMDNodeModule<typeof import('jschardet')>('jschardet', 'dist/jschardet.min.js')`.

- 1.0.0: `binary_expression(binary_expression(identifier, unary_expression(typeof, call_expression(import, arguments))), parenthesized_expression(sequence_expression(...)))`, two comparisons.
- 2.0.0: `call_expression(function: identifier, type_arguments: (type_arguments (type_query (call_expression (import) (arguments)))), arguments: (arguments ...))`.

Without arguments (`f<typeof import('m')>()`) and as an instantiation expression (`f<typeof import('m')>;`) it was an
`ERROR`; it parses now. `f < typeof import('m') > +x;` keeps the 1.0.0 tree (two comparisons, as tsc reads it).
Queries: `queries/highlights.scm` gains the `type_arguments` brackets; the JavaScript `highlights.scm` and `tags.scm`
call patterns now match these calls.

### A block comment before a ternary `?` (N2, #11)

```ts
a
/* c */ ? b : c;
```

- 1.0.0: no error, but the `comment` node is missing: bytes 2-9 belong to no node.
- 2.0.0: the `ternary_expression` is unchanged and a `(comment)` sits between condition and consequence.

Every changed tree differs only by added `(comment)` nodes. In the pinned examples one file changes
(`abstractSynchronizer.ts`, one `(comment [574, 5] - [574, 54])`). Queries: `(comment) @comment` and the JSDoc
injection now also match these comments.

### Line terminators in automatic semicolon insertion (N5, #15) **[pending]**

The external scanner treated only LF as a line break. Now a lone CR, U+2028, U+2029 and a block comment that holds a
line terminator count too (a `//` comment ended by one of these as well), as in tsc. After the change every one of the
11 forms of a line break gives the same tree as the LF form, which is what 1.0.0 gave for LF. Trees that change for
each non-LF form:

| input (line break between the parts) | 1.0.0 | 2.0.0 (= the LF form) | tsc |
| --- | --- | --- | --- |
| `return`/`break`/`continue` and `x`/`L` | `return x` | `return;` + `x;` | `return; x;` |
| `readonly` and `x = 1` in a class | one field `x` | fields `readonly`, `x` | two fields |
| `async` and `m() {}` in a class | async method `m` | field `async`, method `m` | two members |
| `type` and `A = number;` | type alias | `type;` + `A = number;` | two statements |
| `declare` and `const x: number;` | ambient declaration | `declare;` + `const ...` | two statements |
| `static` and `x = 1` | one static field | fields `static`, `x` | one static field (see known differences) |
| `get`/`set` and `x() {}` | getter / setter | field `get`/`set`, method `x` | one accessor (see known differences) |

In the same scanner path, `in` or `instanceof` after a line break now starts the next class or type member when no
binary operator may follow and the next character is `=`, `:`, `?`, `;` or `}`
(`class A { x` + newline + `in = 1; }`, `interface I { a: string` + newline + `in: number }`); these were `ERROR`s.
`for (var x` + newline + `in y)` keeps its `in`. Queries: `static`, `get`, `set`, `readonly` move from `@keyword`
to `@property`; `type`, `declare` and labels get `@variable`; in `get /*` + newline + `*/ x()` the `definition.method`
tag covers only `x(...)`. Counts and oracle cases: take them from #15 when it merges.

### Identifiers starting with `in` after a line break (N7) **[pending]**

The scanner's `in`/`instanceof` check misreads identifiers such as `in_progress`, `in1`, `in$` after a line break.
No pull request yet: add the before/after trees, the tsc verdicts and the counts from it.

## Previously error-free input that is an error now (intended)

| input | 1.0.0 | 2.0.0 | tsc |
| --- | --- | --- | --- |
| `type D<in> = number;` (S1, #9) | ok | `MISSING type_identifier` | TS1359 |
| `type L<in, T> = T;` (S1, #9) | ok | `ERROR` | TS1359, TS1139 |
| `<A t="a&" b="/>;` in TSX (N3, #10) | no error: `t` holds the string `"a&" b="`, the element closes at `/>` | `t="a&"` ends at its own quote, `b="/>;` is an unterminated string: error | TS1002 |
| `a⏎/* c */ +? b : c;` and the same with `-?`, `/?`, `in?`, `instanceof?` (N2, #11) | no error: a plain ternary, comment and operator in no node | `comment` node kept, `ERROR` from the `?` | TS1109 |

All of these inputs are invalid TypeScript. The first two come from `in` becoming a variance modifier; the type
parameter named `in` was never valid. Type parameters named `out` (`type A<out> = out;`, `type B<out = string> = out;`,
`type C<T, out> = out;`, `type E<in out> = number;`) keep parsing without error and keep `out` as a `type_identifier`.

## Inputs that were errors and parse now (additions, no migration needed)

`export type * from 'm'` and its three variants (S2, #3); a bare `&` in TSX JSX text, `<p>Shipping & Handling</p>`
(S6, #4); type arguments on an `import()` type member, `import('foo').Foo<F>` (S4, #5); `static accessor`,
`abstract accessor`, members named `accessor` (S3, #6); variance annotations `in`, `out`, `in out` on type parameters
(S1, #9); tagged templates with object, array, tuple or function type arguments (S5, #7); `&` that starts no character
reference in a TSX attribute string, `text="E&xit"` (N3, #10); an empty type parameter list in declarations,
`type A<> = number;`, `class C<> {}`, `function f<>() {}` (N4, #12 **[pending]**; an arrow function keeps requiring a
non-empty list: `<>(x) => x` stays an error because tsc rejects it); an `import(...)` type followed by `[]` or an
index, `import('x').Y[]`, `import('x')['k']` (N1, #13 **[pending]**); `typeof import(...)` as a type argument
(N1b, #14 **[pending]**); `in`/`instanceof` as a class or type member name after a line break (N5, #15
**[pending]**).

Entries of `test/examples/known-failures.txt` cleared by these: 15 (S6), 3 (S4) and 1 (N3) on `main`; N1 8 and
N1b 15 **[pending]** (14, plus `copilotcliSession.spec.ts`, which needs N1 and N1b: whichever merges second removes
it). The 6 entries for constructs this release does not fix were marked `v1.1:` and are marked `candidate:` now.

Error trees change too, which was never a contract: for example `type A<,> = number;` now gives an `ERROR` on the comma
instead of a zero-width `type_parameter` (N4 **[pending]**).

## Known differences from tsc

Recorded, not fixed in 2.0.0. "Accepts" means the grammar parses without error where `typescript` 7.0.2
(`tsc --noEmit --noCheck --pretty false --target esnext --jsx preserve`) reports a syntax error; "rejects" is the
reverse. Checker-only errors (TS1274 for `function f<in T>() {}`, TS1243 for `readonly accessor x`, TS1098 and TS1099
for empty lists) are out of scope: `--noCheck` drops them.

- **Variance (S1).** Rejects but tsc accepts: `<in in T>`, `<out in T>`, `<out out T>`, `<in const T>` (duplicate or
  misordered modifiers). Accepts but tsc rejects (TS1359): `type E<out extends string> = out;` (read as a parameter
  named `out` with a constraint).
- **`accessor` literals (S3).** Nine inputs `class A { static accessor <member> }` with `<member>` = `012 = 1`,
  `08 = 1`, `0_1 = 1`, `01n = 1`, `"\8" = 1`, `"\1" = 1`, `"\u{110000}" = 1`, `x = 01`, `x = (y: number)` are accepted
  although tsc rejects them; the same text without `accessor` was already accepted at 1.0.0 (the grammar does not
  validate literals). Validating literals is a candidate after 2.0.0.
- **An operator before a ternary `?` after a line break (N2).** `a⏎+? b : c;` (and `-?`, `/?`, `in?`, `instanceof?`,
  and the same after a line comment) are accepted with the operator in no node, before and after 2.0.0; tsc rejects
  them (TS1109).
- **ASI after `static`, `get`, `set` (N5 **[pending]**).** tsc reads `static` + line break + `x = 1` as one static
  field and `get`/`set` + line break + `x() {}` as one accessor; the grammar reads two members (as 1.0.0 did for LF). A
  grammar change, not a scanner change, would be needed. `in()` or `in<T>()` as a method name after a line break
  stays an `ERROR` (the scanner cannot tell it from `for (var x` + newline + `in (y))`).
- **`import(...)` types (S4; N1, N1b **[pending]**).** Ten inputs that tsc rejects parse clean with S4's type-argument
  path; the same defect without type arguments was already accepted at 1.0.0 (`type T = import().A<string>;`,
  `import('m' + '/sub').A<string>`, `import('m', opts).A<string>`, `import('m', {}, {}).A<string>`,
  `import(getModule()).A<string>`, `import('m', { wrong: {} }).A<string>`, `import('m',).A<string>`,
  `import(...args).A<string>`, type arguments on the next line after a type,
  `type T = import('m').A<typeof import('n').B().C<string>>;`). Import-type argument validation and type arguments
  after a newline are candidates after 2.0.0. Still `ERROR` although tsc accepts: `(import('x').Y)`,
  `(import('x').Y)[]`, `[...import('x').Y]`, `import('x')<T>`, `f<import('x').B>()`. Accepted although tsc rejects
  (1.0.0 too): `let x: typeof import('x').y()[];`, `f<typeof g('a')>()`, `let x: A<typeof g('a')>;`. With N1 a `[`
  after a line break is read as a type index after an `import()` type too, as 1.0.0 already did after every other type:
  `v as import('x').Y⏎[a + b]` goes from error-free-but-wrong to an error. ``sql<typeof import('m')>`x`;`` still reads
  as a comparison (1.0.0 too).
- **Empty type argument lists** (`f<>(x)`, `new C<>()`, `A<>`; TS1099 is a checker error) are errors in the grammar. Not
  in 2.0.0; a MINOR candidate (the `<T>x` assertion against a generic arrow needs a conflict design). `async <>(x) => x`
  is an error in both, at different bytes.
- **Tagged templates (S5).** ``f<>`x` `` and `const h = f<T>?.();` are errors although tsc accepts them (unrelated to S5).
- **Still not parsed** and listed as `candidate:` in `test/examples/known-failures.txt`: `unique` after `<` as an
  identifier (`i < unique.length`), `symbol` as a tuple label, `abstract` as an object-type property, `\u` without hex
  digits in a template (`` String.raw`C:\unregistered` ``), a call signature starting with `<` on the line after a
  member without `;`.

## What else changes for a consumer

- **Generated files.** `typescript/src/parser.c` and `tsx/src/parser.c` carry `metadata` 2.0.0 (1.0.0 carried 0.23.2);
  ABI is still 15 and the runtime lower bounds are unchanged (0.25 line, Python 3.10).
- **Go module path.** The module is `github.com/wotjr1649/tree-sitter-typescript/v2` (Go semantic import versioning);
  import the bindings as `github.com/wotjr1649/tree-sitter-typescript/v2/bindings/go`. The functions are unchanged.
- **Shared library name.** The CMake `SOVERSION` is `15.2` (was `15.1`) and the Makefile `SONAME_MINOR` is 2: it
  follows the MAJOR version.
- **Parser size.** At `fdd6dd2` (S1-S6, N2, N3) `typescript/src/parser.c` is 9,287,805 bytes and `tsx/src/parser.c`
  9,335,185 bytes; N4 adds about 20 KB to each **[pending]**. Record the final sizes, and a paired timing (1.0.0 and
  2.0.0 alternating in one run, one slot, CPU load recorded at start and end), in the release PR.
- **Error recovery** of invalid input is not a contract; trees of rejected input may differ inside `ERROR` nodes.
- **Pins.** `go-treesitter` pins a commit (ADR-0001, ADR-0024 rule 7). Bump it on the release commit and re-run its
  schema and corpus comparisons; the node-kind snapshot differs by the lines listed under Schema.
