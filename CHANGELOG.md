# Changelog

## Unreleased

### Fixed

- A tagged template with type arguments parses as a `call_expression` with `type_arguments` in both grammars
  (issue #341): ``f<T>`x` ``, ``a.b<T>`x` ``, ``sql<{ a: string }>`select` ``, ``f<T[]>`x` ``, ``f<[A, B]>`x` ``,
  ``f<() => void>`x` ``. Object, array, tuple and function type arguments were `ERROR`s before; simple ones were
  misread without error as comparisons, ``(f < T) > `x` ``. A prefix, binary or update operator in front binds to the
  whole tagged template, as in tsc (``await sql<T>`x` `` is `await (sql<T>`x`)`), and calls, instantiation expressions
  and comparisons such as `f<T>(x)`, `a < b > c` and `c ? f<R<S>>(d) : e` keep their trees.
  - Node kinds and fields added: none (`call_expression` already has the `type_arguments` field;
    `node-types.json` unchanged in both grammars).
  - Error-free tree changes (intended, the base trees were misparses): ``f<T>`x` ``, ``a.b<T>`x` ``,
    ``f<A, B>`x` ``, ``f<Array<T>>`x` ``, ``f<T>`a${b}c` ``, ``a < b > `x` ``, ``a<b>`x`.y``, ``f<T>`x``y` ``,
    ``await sql<T>`x` `` and ``new Foo<T>`x` `` (now `new (Foo<T>`x`)`), and the same forms after `+`, `*`, `typeof`,
    `void`, `delete`, `!`, `-` and `++`, change from `binary_expression` / `sequence_expression` trees to
    `call_expression` + `type_arguments`. tsc reads all of them as tagged templates. Highlight and tag queries match
    accordingly (for example `@function` and `@reference.call` on the tag).
  - `test/examples/known-failures.txt`: no entry cleared.
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #382 by @jhoward321, head commit
    `3517fdf4b0de94c7abc48df803a1118d7286ca4e` (grammar hunks and corpus tests taken unchanged). PR #342 and #350 are
    not used.
