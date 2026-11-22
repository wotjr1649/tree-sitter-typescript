# Moving from 2.0.0 to the JavaScript v4.4.0 port

The TypeScript and TSX grammars now extend the vendored JavaScript grammar from
`wotjr1649/tree-sitter-javascript` v4.4.0. This is a MAJOR change because some valid inputs that parsed without
error in 2.0.0 have different trees. Queries and tree walkers that match those shapes need updating.
[CHANGELOG](../CHANGELOG.md#unreleased)

## Full CST comparison against 2.0.0

The comparison covers the corpus, the tsc 7.0.2 oracle, the pinned examples and JavaScript regression inputs at
`9ca6dae`. It compares node kinds, fields, child order and source ranges, including `ERROR` and `MISSING` nodes.

| Grammar | Input–grammar pairs | Identical | Valid, error-free trees changed | Error to ok | Error to error, changed | Rejected by tsc, ok to error | Rejected by tsc, ok to ok changed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `typescript` | 18,942 | 16,961 | 897 | 181 | 87 | 815 | 1 |
| `tsx` | 2,816 | 1,656 | 66 | 192 | 87 | 815 | 0 |
| Total | 21,758 | 18,617 | 963 | 373 | 174 | 1,630 | 1 |

The result columns are mutually exclusive. Three of the 17,665 example files now parse, leaving 11 known failures.

## Schema (`node-types.json`)

Both grammars add `using_declaration` as a named subtype of `declaration`. It has one or more
`variable_declarator` children. The `kind` field is `required: true` and `multiple: true` in the schema.
It holds the anonymous `"using"` token and, for `await using`, a preceding anonymous `"await"` token.
The node-kind snapshots add `using_declaration{kind}`. All existing node kinds, field names and supertype subtypes
are retained.

| Node | Changed child types |
| --- | --- |
| `await_expression` | `expression` becomes `await_expression`, `instantiation_expression`, `new_expression`, `primary_expression`, `unary_expression`, `update_expression` and `type_assertion` (TypeScript), or the same list with `jsx_element` and `jsx_self_closing_element` in place of `type_assertion` (TSX). |
| `non_null_expression` | `expression` becomes `new_expression`, `primary_expression` and `update_expression`, plus `jsx_element` and `jsx_self_closing_element` in TSX. |
| `parenthesized_expression` | The explicit `call_expression`, `identifier` and `member_expression` entries are covered by `expression`. `sequence_expression` is still listed. |
| `instantiation_expression` | `expression` becomes `new_expression` and `primary_expression`, plus `jsx_element` and `jsx_self_closing_element` in TSX. |

Regenerate typed tree wrappers from the new schema. When validating concrete child kinds, expand the supertypes
from the schema for the grammar in use.

## Trees that change for previously error-free input

The excerpts omit unchanged parts of each tree. Byte ranges use `[start, end)`. In inline reproductions `\n` and
`\r` denote actual LF and CR bytes.

### Separate ampersands before a JSX attribute's closing quote (A1)

`<a b="&&"/>` in TSX

- 2.0.0 gives `(string (string_fragment))`, with `&&` in `[6, 8)`.
- The port gives `(string (string_fragment) (string_fragment))`, with one `&` in each of `[6, 7)` and `[7, 8)`.

Slice the source by the attribute `string` node's byte range or iterate all its fragments in source order.
A query that captures one fragment can miss the second `&`.

### Merged fragments around incomplete JSX character references (A2)

`<A t="&#"/>` in TSX

- 2.0.0 gives `(string (string_fragment) (string_fragment))`, for `&` and `#`.
- The port gives `(string (string_fragment))`, for `&#` in `[6, 8)`.

Consume each fragment as text. In `<A t="&&amp;"/>`, the `string` has a `string_fragment` for the first `&`
and an `html_character_reference` for `&amp;`. Match both child kinds when reading the value.

### A trailing comment on a bare declaration (A3)

`let x/**/`

- 2.0.0 gives `(lexical_declaration (variable_declarator name: (identifier)) (comment))` in `[0, 9)`.
- The port gives `(program (lexical_declaration (variable_declarator name: (identifier))) (comment))`. The
  declaration ends at byte 5.

Check the declaration's following sibling for a trailing comment. Use the comment's own range when moving or
rewriting it.

### A trailing comment on a function initializer (A4)

`let x=function(){}//`

- 2.0.0 gives `(variable_declarator value: (function_expression body: (statement_block (comment))))`.
- The port gives `(lexical_declaration (variable_declarator value: (function_expression body: (statement_block))) (comment))`.
  The declarator and its function value end at byte 18, the start of the comment.

Find the `comment` as a direct child of `lexical_declaration`, beside the `variable_declarator`. Use the
`function_expression` range to extract the function.

### `await` followed by `as` (B2)

`let x=await res()as{}`

- 2.0.0 gives `(await_expression (as_expression (call_expression) (object_type)))`.
- The port gives `(as_expression (await_expression (call_expression)) (object_type))`.

Match the cast first and then its awaited expression.

The same change affects `export{};let x=await f()as A.B.C` (C1). The `.C` is a value member in both trees.
tsc reads it as part of the qualified type.

- 2.0.0 gives `(await_expression (member_expression object: (as_expression (call_expression) (nested_type_identifier))))`.
- The port gives `(member_expression object: (as_expression (await_expression (call_expression)) (nested_type_identifier)))`.

Follow the member's `object` to the cast and its `await_expression`.

### Postfix non-null assertions in larger expressions (B6)

| Input | 2.0.0 excerpt | Port excerpt |
| --- | --- | --- |
| `(a??a!.uri)` | `(member_expression object: (non_null_expression (binary_expression)))` | `(binary_expression right: (member_expression object: (non_null_expression (identifier))))` |
| `f(!res!.length)` | `(member_expression object: (non_null_expression (unary_expression)))` | `(unary_expression argument: (member_expression object: (non_null_expression (identifier))))` |
| `()=>value==resizedBand![index]` | `(subscript_expression object: (non_null_expression (binary_expression)))` | `(binary_expression right: (subscript_expression object: (non_null_expression (identifier))))` |

Visit `non_null_expression` on the specific operand under the enclosing binary, unary or postfix expression.
For example, a query for a `binary_expression` child of `non_null_expression` can become a query on the
`right` operand of `binary_expression` and the member or subscript's `object`.

The postfix restriction on typed callees also changes shapes without a non-null assertion. In
`1024 * f<number>(0)`, `(call_expression function: (binary_expression) …)` becomes
`(binary_expression right: (call_expression function: (identifier) …))`. In `void f<T>()`,
`(call_expression function: (unary_expression) …)` becomes
`(unary_expression argument: (call_expression function: (identifier) …))`. Query the call under the outer
operator and the callee through its `function` field.

### Prefix operators before a typed call and member access (B7)

`!!second<T>(0).complete`

- 2.0.0 gives `(member_expression object: (call_expression function: (unary_expression argument: (unary_expression)) …))`.
- The port gives `(unary_expression argument: (unary_expression argument: (member_expression object: (call_expression function: (identifier) …))))`.

Walk through the prefix node's `argument` to the member access, then its `object` to the call. This also applies
to a single prefix operator in `!f<T>().x`.

### Trailing comments on statements and bodies (B8)

| Input | 2.0.0 excerpt | Port excerpt |
| --- | --- | --- |
| `{save//\n}` | `(expression_statement (identifier) (comment))` | `(statement_block (expression_statement (identifier)) (comment))` |
| `function f(){return//\n}` | `(return_statement (comment))` | `(statement_block (return_statement) (comment))` |
| `{if(0){}//\n}` | `(if_statement consequence: (statement_block (comment)))` | `(statement_block (if_statement consequence: (statement_block)) (comment))` |
| `{try{}catch{}//\n}` | `(try_statement handler: (catch_clause body: (statement_block (comment))))` | `(statement_block (try_statement handler: (catch_clause body: (statement_block))) (comment))` |
| `class{m(){}//\n}` | `(method_definition body: (statement_block (comment)))` | `(class_body (method_definition body: (statement_block)) (comment))` |
| `export class A{}//` | `(export_statement declaration: (class_declaration (comment)))` | `(program (export_statement declaration: (class_declaration)) (comment))` |
| `{for(;;){}//\n}` | `(for_statement body: (statement_block (comment)))` | `(statement_block (for_statement body: (statement_block)) (comment))` |

The preceding statement or member now ends before the comment. Find the comment as a sibling in the enclosing
`statement_block`, `class_body` or `program`. To attach same-line trailing comments, compare the preceding
node's end row with the comment's start row.

### `super` in a parenthesized decorator (B9)

`class{@(super.decorate)m(){}}`

- 2.0.0 gives `(member_expression object: (identifier) property: (property_identifier))`.
- The port gives `(member_expression object: (super) property: (property_identifier))`.

Under `decorator` and `parenthesized_expression`, match `(super)` as the member object. A query supporting both
versions can match `[(identifier) (super)]` and check the object text where needed.

### `this` in a JSX member tag (B10)

`<this.C/>` and `<this.C<T>/>` in TSX

- 2.0.0 gives `(member_expression object: (identifier) property: (property_identifier))` in the tag's `name` field.
- The port gives `(member_expression object: (this) property: (property_identifier))` there.

Allow `(this)` in the member's `object` field when matching JSX tag names.

### Resource declarations (B11)

`using as=f()`

- 2.0.0 gives `(expression_statement (assignment_expression left: (identifier) right: (call_expression)))`.
- The port gives `(using_declaration kind: "using" (variable_declarator name: (identifier) value: (call_expression)))`.

In `await using as=f()`, the old statement wrapped the assignment in `await_expression`. The port puts `await`
and `using` in the declaration's `kind` field. Match `using_declaration` and read the `name` and `value` fields
of each `variable_declarator`. Iterate `kind` tokens to detect the async form. A line break between `await` and
`using` in an async function or module also gives one `using_declaration` when the binding starts on the same
line as `using`.

### CR-terminated hashbangs (H1)

`#!\r`

- 2.0.0 gives `(hash_bang_line)` in `[0, 3)`, including the CR.
- The port gives `(hash_bang_line)` in `[0, 2)`, ending before the CR.

When replacing a whole hashbang line, handle the line terminator separately from the node's range.

### `await` of a type-argument call (N01, N02)

| Input | 2.0.0 excerpt | Port excerpt |
| --- | --- | --- |
| `export{};await f<T>()` | `(call_expression function: (await_expression (identifier)) type_arguments: (type_arguments))` | `(await_expression (call_expression function: (identifier) type_arguments: (type_arguments)))` |
| `function f(){ await g<T>(); }` | `(call_expression function: (await_expression (identifier)) type_arguments: (type_arguments))` | `(await_expression (call_expression function: (identifier) type_arguments: (type_arguments)))` |
| `export{};await f<T>().x` | `(member_expression object: (call_expression function: (await_expression (identifier))) property: (property_identifier))` | `(await_expression (member_expression object: (call_expression function: (identifier)) property: (property_identifier)))` |

Find awaited typed calls under `await_expression`. With a member access, follow its `object` field to the
`call_expression`. The call's `function` field contains the identifier. In an ordinary function, `await(x)` is a call.

## Other differences

- TypeScript and TSX leave Annex B HTML-like comment markers to the normal grammar. Code such as `a/*\n*/<!--x\n+b`
  parses using `<`, `!` and `--`. Some multiline forms also change the association of successive `<` operators.
- The generated `parser.c` is 11,821,267 bytes for TypeScript and 12,552,303 bytes for TSX, up 25.7% and 33.1%
  from 2.0.0. LR state counts are 10,482 and 11,034, up from 6,719 and 6,851 respectively.
