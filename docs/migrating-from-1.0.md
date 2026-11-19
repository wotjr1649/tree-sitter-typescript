# Moving from 1.0.0 to 2.0.0

2.0.0 is the first release that changes how the grammars parse. 1.0.0 is the upstream v0.23.2 grammar regenerated with
CLI 0.27.2 (`tree-sitter/tree-sitter-typescript` `f975a62`, see ADR-0001), with identical behaviour. Versions follow
SemVer from here (ADR-0001 amendment): this is a MAJOR release because the tree of some input that parsed without
error at 1.0.0 is different now. A query or a tree walker written against the old tree of those forms can stop
matching. Nothing is removed or renamed: no node kind and no field.

Counts below come from the pull request that carries them (named next to each change), measured against that pull
request's base; the CHANGELOG entry of each change gives the full lists.

## Schema (`node-types.json`)

Nothing removed, nothing renamed. Added or relaxed, in both grammars unless noted:

| change | from | note |
| --- | --- | --- |
| `member_expression` may have a `type_arguments` child (no field name) | S4, #5 | `import('m').X<T>` in type position |
| anonymous node `out` | S1, #9 | variance modifier; a parameter named `out` is still a `type_identifier`. `in` was an anonymous node already. |
| the `children` of `type_parameters` go from `required: true` to `required: false` | N4, #12 | `type A<> = number;`; a relaxation, nothing removed. A consumer that trusts `required` must allow an empty list. |
| the `primary_type` supertype lists `call_expression` and `member_expression` as subtypes | N1, #13 | `import('x').Y[]`; trees change only for an index after `as`/`satisfies` (below) |
| `arguments` lists `object` and `string` among its children | N1b, #14 | `typeof import('m', { with: ... })` in a type query (hidden `_type_query_import_arguments`, aliased to `arguments`) |

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

### An index after `as`/`satisfies import(...)` (N1, #13)

`const x = v as import('x').Y['k'];`, `v satisfies import('x')['k']`, `v as import('x').Y[0]`, `v as import('x').Y[a.b]`
(index on the same line; tsc accepts them and reads the index as part of the type):
- 1.0.0: a `subscript_expression` around the `as_expression` (or `satisfies_expression`).
- 2.0.0: a `lookup_type` inside the type, as tsc reads it.

Same change in both grammars. A consumer that matched `subscript_expression` over an `as` expression on such input
must match `lookup_type` instead. No query in `queries/` or in the inherited JavaScript queries names
`subscript_expression`, `lookup_type`, `as_expression` or `array_type`; the highlight captures on a `string`/`number`
index are unchanged. With the index on the next line see "Valid input that is an error now" below.

### `f<typeof import('m')>(args)` (N1b, #14)

36 of the 17,665 files of the pinned examples change (all in `examples/vscode`), all the same construct:
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

### Line terminators in automatic semicolon insertion (N5, #15)

The external scanner treated only LF as a line break. Now a lone CR, U+2028, U+2029 and a block comment that holds a
line terminator count too (a `//` comment ended by one of these as well), as in tsc. Each of them acts exactly as LF
does at `e56ad86` (owner decision 24): the scanner makes the same decision after it as after an LF, so the input gets
the tree its LF form gets. Trees that change for each non-LF form (where that tree differs from the old one):

| input (line break between the parts) | 1.0.0 | 2.0.0 (= the LF form) | tsc |
| --- | --- | --- | --- |
| `return`/`break`/`continue` and `x`/`L` | `return x` | `return;` + `x;` | `return; x;` |
| `readonly` and `x = 1` in a class | one field `x` | fields `readonly`, `x` | two fields |
| `async` and `m() {}` in a class | async method `m` | field `async`, method `m` | two members |
| `type` and `A = number;` | type alias | `type;` + `A = number;` | two statements |
| `declare` and `const x: number;` | ambient declaration | `declare;` + `const ...` | two statements |
| `static` and `x = 1` | one static field | fields `static`, `x` | one static field (see known differences) |
| `get`/`set` and `x() {}` | getter / setter | field `get`/`set`, method `x` | one accessor (see known differences) |
| `yield` and `x` | `yield x` | `yield;` + `x;` | two statements |
| `public`/`private`/`protected`/`declare`/`override`/`accessor` and a member | one member with the modifier | a field named by the keyword, then the member | two members |
| `type T = A` and `[B];` | `lookup_type` | `type T = A;` + `[B];` | two statements |

The same holds for a line comment ended by U+2028, U+2029 or a lone CR after an LF (`a⏎// c<U+2028>+b`): 1.0.0 read
the comment on to the next LF and decided there; now the text after the comment decides, as with LF. So
`a⏎// c<U+2028>+b`, `-b`, `(b)`, `[b]`, `` `x` ``, `<T>(x)` continue the expression (as tsc reads them; before, two
statements), and `return⏎// c<U+2028>+x`, `yield⏎// c<U+2028>(x)` attach the operand as their LF forms do (tsc splits
them). A block comment that holds the line break now follows the inserted semicolon (a sibling of the statement or
member) instead of sitting inside it.

Queries follow the trees: the keyword of a split modifier gets `@property` (JavaScript highlights) instead of
`@keyword`; `type`, `declare`, `async` and labels get `@variable`; for `async`/`override` + method the
`definition.method` tag and `local.scope` start at the method name; in `set /*⏎*/ x(v) {}` the comment becomes the
`@doc` of method `x`. None of the 17,665 pinned example files changes its tree (compared with `e56ad86`).

### Identifiers starting with `in` and `let` across a line break (N7, #17)

After a line break the external scanner took a word that starts with `in` or `instanceof` (`in_x`, `in1`, `in$`) for
the keyword when the next character was not a letter by the C library's `iswalpha()`, so no semicolon was inserted
(owner decision 12). Now such a word is an identifier: the line ends before it, as tsc reads it. `in` and `instanceof`
themselves read as before. Separately, `let` + line break + a word that is not reserved, or `{`, continues the
declaration, as tsc and the specification read it (owner decisions 22 and 25); before, `let` ended the statement after
an LF (and, with N5 alone, after the other line breaks).

| input (`⏎` = line break) | 1.0.0 | 2.0.0 | tsc |
| --- | --- | --- | --- |
| `let⏎x = 1;`, `let⏎x, y;`, `let⏎type = 1;`, `let⏎φ = 1;` | `let;` + an assignment or sequence | one `lexical_declaration` | one declaration |
| `let⏎{ a: b, ...c } = d;`, `let⏎{ x }`, `let⏎{}` | `let;` + an assignment to an object pattern, a block or an object | one `lexical_declaration` with an `object_pattern` | one declaration |
| `function* g() { let⏎yield }` | `let;` + `yield_expression` | `let yield` | `let yield` |
| `yield⏎in_x` | `yield_expression` with operand `in_x` | `yield;` + `in_x;` | two statements |
| `type⏎in_x = number;` | `type_alias_declaration` | `type;` + an assignment | two statements |
| `async⏎in_x => in_x` | async arrow function | identifier `async` + an arrow function | two statements |
| `continue⏎in_x;` in a loop | `continue` with the label `in_x` | `continue;` + `in_x;` | two statements |
| `private⏎in_x = 1` (also `public`, `protected`, `declare`, `override`) in a class | one field with the modifier | a field named by the keyword + field `in_x` | two members |
| `readonly⏎in_x: number` in an interface | one readonly property | two properties | two properties |
| `set⏎in_x(v) {}` in a class | a setter | field `set` + method `in_x` | one setter (see known differences) |

With CR, U+2028, U+2029 or a line-breaking block comment, 1.0.0 already read the `let` rows as one declaration; N5 made
them two statements and N7 makes them one again. Words after `let⏎` that start with `in`/`instanceof` and go on with
`_`, a digit, `$` or `\` (`let⏎in_x = 1;`) keep their tree. `let⏎(x)`, `let⏎[a] = b`, `const` and `let` + line break +
a reserved word (`let⏎if (x) {}`, `let⏎in b`) keep their trees; where `let` is only an expression (`x = let⏎{}`) a
block after it stays a block. `lexical_declaration` takes a hidden external token `_lexical_declaration_binding` after
`let`/`const` (never produced, it only marks the position): `grammar.json` and `parser.c` change, `node-types.json`
does not.

Queries follow the trees: in the bundled JavaScript queries `let` goes from `@variable`/`local.reference` to `@keyword`
and the binding gains `local.definition`; a split modifier keyword gets `@property` instead of `@keyword`; `type` and
`async` lose `@keyword`; in `set⏎in_x(v) {}` `local.scope` and `definition.method` start at `in_x`. None of the 17,665
pinned example files changes its tree (compared with `main` `d4c5286`, the base of #17).

## Previously error-free input that is an error now (intended)

| input | 1.0.0 | 2.0.0 | tsc |
| --- | --- | --- | --- |
| `type D<in> = number;` (S1, #9) | ok | `ERROR` on the `in` token `[7,9)` (with N4; S1 alone gave a `MISSING type_identifier`) | TS1359 |
| `type L<in, T> = T;` (S1, #9) | ok | `ERROR` | TS1359, TS1139 |
| `<A t="a&" b="/>;` in TSX (N3, #10) | no error: `t` holds the string `"a&" b="`, the element closes at `/>` | `t="a&"` ends at its own quote, `b="/>;` is an unterminated string: error | TS1002 |
| `a⏎/* c */ +? b : c;` and the same with `-?`, `/?`, `in?`, `instanceof?` (N2, #11) | no error: a plain ternary, comment and operator in no node | `comment` node kept, `ERROR` from the `?` | TS1109 |
| `let⏎ordinary();`, `let⏎ordinary.x = 1;`, `let⏎ordinary => ordinary;`, `let⏎type T = number;`, `let⏎interface I {}` and similar (N7, #17) | `let;` + a second statement | `ERROR` | TS1005 |
| `let⏎{ foo() }`, `let⏎{ x = 1; }` (N7, #17) | `let;` + a block | `ERROR` | TS1005 |

All of these inputs are invalid TypeScript. The first two come from `in` becoming a variance modifier; the type
parameter named `in` was never valid. The N7 rows come from `let` + line break + a non-reserved word or `{` continuing
the declaration, as tsc reads it; tsc then expects `,`. Type parameters named `out` (`type A<out> = out;`, `type B<out = string> = out;`,
`type C<T, out> = out;`, `type E<in out> = number;`) keep parsing without error and keep `out` as a `type_identifier`.

## Valid input that is an error now (recorded)

tsc accepts these and the grammar now gives `ERROR`, as a related form already did before (recorded under owner
decision 10's rule: no new kind of difference); the counts below say which of them parsed without error before.
Fixing them needs a grammar change, a candidate after 2.0.0.

- **An index on the line after an `import(...)` type (N1, owner decision 14).** `const x = v as import('x').Y` + line
  break + `[a + b];` (also `satisfies`, `[f()]`, `[a?.b]`): a `subscript_expression` at 1.0.0, an `ERROR` now; tsc
  reads two statements. 1.0.0 already reads every other type this way (`v as Foo` + line break + `[a + b];` is an
  `ERROR`).
- **A non-LF line break before a member named `in`/`instanceof`, `with /* c */ {`, `<B>(` or `as T⏎[` (N5, owner
  decisions 20, 23, 24 and 27).** With a lone CR, U+2028, U+2029 or a line-breaking block comment as the line break:
  `class A { a⏎in = 1; }`, `class A { a⏎in() {} }`, `class A { a⏎in<T>() {} }`, `interface I { a: string⏎in(): void }`
  (also `instanceof`); `import x from "m"<CR>with /* c */ { type:
  "json" };`; `interface A { a: T⏎// c<U+2028><B>(b: B): V; }`; `a as T⏎// c<U+2028>[b + c];`. The LF form of each is an
  `ERROR` at `e56ad86` too. Over the 5,938 review and oracle inputs that contain such a line break, 1,080 are of this kind
  (tsc accepts, `ERROR` here, `ERROR` for the LF form at `e56ad86`); 170 of them parsed without error at `e56ad86`
  itself. By shape: `in`/`instanceof` member 952, `with` comment 24, `as T⏎[` 26, interface `<B>(` 26, a comment
  between `}` and `:` of a typed object pattern 26, `for (using a⏎of b)` 26. These counts are N5's (#15); the
  `in`/`instanceof` count also held members whose names only start with them (`in1`, `in_`, `in$`), which parse since
  N7 (#17).

## Inputs that were errors and parse now (additions, no migration needed)

`export type * from 'm'` and its three variants (S2, #3); a bare `&` in TSX JSX text, `<p>Shipping & Handling</p>`
(S6, #4); type arguments on an `import()` type member, `import('foo').Foo<F>` (S4, #5); `static accessor`,
`abstract accessor`, members named `accessor` (S3, #6); variance annotations `in`, `out`, `in out` on type parameters
(S1, #9); tagged templates with object, array, tuple or function type arguments (S5, #7); `&` that starts no character
reference in a TSX attribute string, `text="E&xit"` (N3, #10); an empty type parameter list in declarations,
`type A<> = number;`, `class C<> {}`, `function f<>() {}` (N4, #12; an arrow function keeps requiring a non-empty
list: `<>(x) => x` stays an error because tsc rejects it); an `import(...)` type followed by `[]` or an index,
`import('x').Y[]`, `import('x')['k']` (N1, #13); `typeof import(...)` as a type argument,
`importOriginal<typeof import('vscode')>()` and `f<typeof import('m')>;` (N1b, #14); a lone CR, U+2028, U+2029 or a
line-breaking block comment as an automatic-semicolon line break, `a = b /*⏎*/ c = d;`, `x<U+2028>++y;`,
`class A { static accessor /*⏎*/ x = 1; }` (N5, #15); with any line break, LF included, `}` before `:` of a typed
object pattern, `type F = ({ a⏎}: { a: number }) => number;`, and `with {` of import attributes on the next line,
`import x from "x"⏎with { type: "json" };` (N5); `type F = ({ a }<U+FEFF>: { a: number }) => number;` and the same
with U+200B (N5, owner decision 26); a word that starts with `in`/`instanceof` after a line break, `a = b⏎in_progress =
true`, `foo()⏎in1.x()`, `class A { x⏎in_y = 1; }`, `interface I { a: string⏎in_b: number }` (N7, #17); `let` + line
break + a binding, `let⏎ordinary: number[] = [];`, `let⏎{ x } = obj;`, `let⏎await` (N7, owner decisions 22 and 25).

Entries of `test/examples/known-failures.txt` cleared by these: 15 (S6), 3 (S4), 1 (N3), 8 (N1) and 15 (N1b; one of
them, `copilotcliSession.spec.ts`, needed N1 and N1b), 42 in all; 14 remain. The 6 entries for constructs this release
does not fix were marked `v1.1:` and are marked `candidate:` now.

Error trees change too, which was never a contract: for example `type A<,> = number;` now gives an `ERROR` on the comma
instead of a zero-width `type_parameter` (N4).

## Known differences from tsc

Recorded, not fixed in 2.0.0. "Accepts" means the grammar parses without error where `typescript` 7.0.2
(`tsc --noEmit --noCheck --pretty false --target esnext --jsx preserve`) reports a syntax error; "rejects" is the
reverse. Checker-only errors (TS1274 for `function f<in T>() {}`, TS1243 for `readonly accessor x`, TS1098 and TS1099
for empty lists) are out of scope: `--noCheck` drops them.

The owner decisions are numbered as in the release's decision record.

- **Variance (S1, owner decision 2).** Rejects but tsc accepts: `<in in T>`, `<out in T>`, `<out out T>`, `<in const T>`
  (duplicate or misordered modifiers). Accepts but tsc rejects (TS1359): `type E<out extends string> = out;` (read as a
  parameter named `out` with a constraint).
- **`accessor` literals (S3, owner decision 8).** Nine inputs `class A { static accessor <member> }` with `<member>` =
  `012 = 1`, `08 = 1`, `0_1 = 1`, `01n = 1`, `"\8" = 1`, `"\1" = 1`, `"\u{110000}" = 1`, `x = 01`, `x = (y: number)` are
  accepted although tsc rejects them; the same text without `accessor` was already accepted at 1.0.0 (the grammar does
  not validate literals). Validating literals is a candidate after 2.0.0.
- **An operator before a ternary `?` after a line break (N2).** `a⏎+? b : c;` (and `-?`, `/?`, `in?`, `instanceof?`,
  and the same after a line comment) are accepted with the operator in no node, before and after 2.0.0; tsc rejects
  them (TS1109).
- **ASI after `static`, `get`, `set` (N5, owner decision 12).** tsc reads `static` + line break + `x = 1` as one static
  field and `get`/`set` + line break + `x() {}` as one accessor; the grammar reads two members, for every line-break
  form (1.0.0 already did for LF). A grammar change, not a scanner change, would be needed.
- **A class or type member named `in`/`instanceof` after a line break, and the other shapes above (N5, owner
  decisions 20, 23, 24 and 27).** Only a member named `in` or `instanceof` itself; names that start with them parse
  since N7. Rejected for every line-break form, LF included; see "Valid input that is an error
  now". `for (var x⏎in y)` keeps its `in`.
- **Words starting with `in` after a line break (N7).** Accepted although tsc rejects them: after `a = b` and a line
  break, `in💩 = 1;`, `in\u0021 = 1;`, `in\u0073tanceof = 1;` (the grammar's identifier token takes any non-space
  character; the same words not starting with `in` were accepted at 1.0.0). `set⏎in_x(v) {}` reads as two members, as
  `set⏎x(v) {}` already did (owner decision 12). U+0085 (NEL) is white space for tsc but an identifier character for the
  grammar, as at 1.0.0: `a⏎in<U+0085> b;` is an `ERROR`.
- **ASI leniency (N5, owner decisions 10 and 26).** Accepted although tsc rejects, each the same defect 1.0.0 already
  has for the LF form (or, for U+2060, for the empty pattern): `yield` then `*x` on the next line, a ternary after `/?`
  that loses its `/` (also on one line: `a /? b : c;`), a missing required `;` in a `for` header, an automatic
  semicolon after a Flow-style ambient module type annotation, `with /* c */ (y) {}` after a lone CR,
  `for (var x⏎// c<U+2028>in (<div>{else}</div>)) {}`, and `type F = ({ a }<U+2060>: { a: number }) => number;`
  (TS1127). `return /*⏎*/ +x`, `return /*⏎*/ /r/.test(s)`, `yield /*⏎*/ (x)` and their line-comment forms keep the
  operand as their LF forms do; tsc splits them.
- **`import(...)` types (S4, owner decision 10; N1, owner decision 14; N1b, owner decisions 15 and 21).** Ten inputs
  that tsc rejects parse clean with S4's type-argument path; the same defect without type arguments was already accepted
  at 1.0.0 (`type T = import().A<string>;`, `import('m' + '/sub').A<string>`, `import('m', opts).A<string>`,
  `import('m', {}, {}).A<string>`, `import(getModule()).A<string>`, `import('m', { wrong: {} }).A<string>`,
  `import('m',).A<string>`, `import(...args).A<string>`, type arguments on the next line after a type, `type T =
  import('m').A<typeof import('n').B().C<string>>;`). Import-type argument validation and type arguments after a newline
  are candidates after 2.0.0. Still `ERROR` although tsc accepts: `(import('x').Y)`, `(import('x').Y)[]`,
  `[...import('x').Y]`, `import('x')<T>`, `f<import('x').B>()`. Accepted although tsc rejects (1.0.0 too): `let x:
  typeof import('x').y()[];`, `f<typeof g('a')>()`, `let x: A<typeof g('a')>;`. With N1 a `[` after a line break is read
  as a type index after an `import()` type too, as 1.0.0 already did after every other type: `v as import('x').Y⏎[a +
  b]` goes from error-free-but-wrong to an error. ``sql<typeof import('m')>`x`;`` still reads as a comparison (1.0.0
  too). With N1b an import type argument other than a string literal (`f<typeof import(m)>(1, 2)`, `import(42)`) stays a
  comparison chain where tsc reads a call (1.0.0 too), and `f<typeof import('m', { x: 1 })>(1, 2)` and `f<typeof
  import('m', {})>(1, 2)` are calls without an error where tsc reads a comparison or reports TS1005 (new with N1b;
  decision 21).
- **Empty type argument lists (owner decision 5)** (`f<>(x)`, `new C<>()`, `A<>`; TS1099 is a checker error) are errors
  in the grammar. Not in 2.0.0; a MINOR candidate (the `<T>x` assertion against a generic arrow needs a conflict
  design). `async <>(x) => x` is an error in both, at different bytes.
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
- **Parser size.** `typescript/src/parser.c` is 9,403,434 bytes and `tsx/src/parser.c` 9,432,380 bytes (1.0.0:
  8,762,937 and 8,786,828).
- **Error recovery** of invalid input is not a contract; trees of rejected input may differ inside `ERROR` nodes.
- **Pins.** `go-treesitter` pins a commit (ADR-0001, ADR-0024 rule 7). Bump it on the release commit and re-run its
  schema and corpus comparisons; the node-kind snapshot differs by the lines listed under Schema.
