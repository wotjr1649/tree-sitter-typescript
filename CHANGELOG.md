# Changelog

## Unreleased

### Fixed

- An `import(...)` type whose member takes type arguments parses without error in both grammars (issues #322, #352):
  `type Foo = import('foo').Foo<F>`, `let x: import('m').C<string, number>`, `type T = import('m').A.B<string>`.
  Before, the `<...>` part was an `ERROR` (or a `MISSING ";"` followed by a stray type assertion). The type arguments
  are a child of the `member_expression` that the grammar already uses for `import('m').X` in type position.
  - Node kinds and fields added: `member_expression` may now have a `type_arguments` child (no field name), in both
    grammars. No node kind or field removed or renamed.
  - Error-free tree changes: none found (existing corpus inputs and the P112 `importtype-*` inputs, both grammars).
  - `test/examples/known-failures.txt`: 3 entries cleared (`v1.1: import(...) type followed by a member, type
    arguments, index or []`). Not fixed by this change, still listed: an `import(...)` type followed by `[]` or an
    index (`import('x').Y[]`, `import('x').Y['k']`; 8 entries) and `typeof import(...)` as a type argument
    (`importOriginal<typeof import('vscode')>()`; 15 entries).
  - Credit: upstream tree-sitter/tree-sitter-typescript PR #365 by @elecnix, head commit
    `92634edfbf75963f8b47c6740e9e89ee289ae3df` (grammar hunks and corpus test taken unchanged).
