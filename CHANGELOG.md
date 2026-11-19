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
    `[_call_signature, constructor_type]` move to it.
  - Known difference: an empty type argument list (`f<>(x)`, `new C<>()`, `let x: A<>;`), which `tsc` also accepts
    with `--noCheck` (TS1099 is a checker error), still gives an error; it is not part of this release.
