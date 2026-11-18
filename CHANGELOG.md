# Changelog

## Unreleased

### Fixed

- Variance annotations on type parameters parse without error in both grammars (issue #370): `interface I<in T>`,
  `type B<out T>`, `class C<in out T>`, `class D<const in T>`, `declare class C<in out T>`,
  `type G<in A, out B>`, `interface Q<out A extends string = 'a'>`. Before, `in`/`out` there was an `ERROR`. The
  modifiers are anonymous tokens before the `name` field of `type_parameter`. A type parameter may still be named
  `out`: `type A<out> = out`, `type B<out = string> = out`, `type C<T, out> = out` and `type E<in out> = number` keep
  parsing as before, and `out` stays an ordinary identifier elsewhere (`const out = 1; out.x;`, `let x: out;`).
  - Node kinds and fields added: the anonymous node `out`, in both grammars. No node kind or field removed or renamed.
  - Error-free tree changes: none found (existing corpus inputs and the P112 variance inputs, both grammars).
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
