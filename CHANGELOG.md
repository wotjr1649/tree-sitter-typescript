# Changelog

## Unreleased

### Fixed

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
  - Kept as they are (owner decision, 2026-11-19): `type A<in in T> = T;`, `<out in T>`, `<out out T>` and
    `<in const T>` still report an error, although tsc's parser accepts them (it rejects them only in the checker,
    TS1030 / TS1029); `type E<out extends string> = out;` still parses without error (a parameter named `out` with a
    constraint), although tsc rejects it (TS1359).
  - `test/examples/known-failures.txt`: no entry cleared (no listed file uses variance annotations).
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #364 by @tomerwave, head commit
    `465aa162d077093dc5ad4f46a9463bde6274425e` (grammar hunk and corpus test taken unchanged). Keeping `out` usable
    as a type parameter name (`alias('out', $.type_identifier)` in `name`) is ours; with #364 alone those inputs
    become errors.
