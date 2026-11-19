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
- A block comment that starts a line before a ternary `?` is kept in the tree, in both grammars: in `a⏎/* c */ ? b : c;`
  the `comment` node was missing (no `ERROR`, no `MISSING`, the comment's bytes simply belonged to no node). The
  external scanner, deciding whether to insert a semicolon after `a`, skipped the comment and then read the `?` as the
  ternary question mark from there. It already refused to do that after a line comment; it now does the same after a
  block comment (`common/scanner.h`; the port of tree-sitter-javascript `e7d9759` in upstream `52f79e4` had kept only
  the line-comment half). `tsc` 7.0.2 accepts these inputs.
  - Node kinds and fields added: none (no generated file changes).
  - Error-free tree changes: inputs of this shape gain the `comment` node they lacked; nothing else in their trees
    changes. Among the pinned example files exactly one has this shape,
    `examples/vscode/src/vs/platform/userDataSync/common/abstractSynchronizer.ts` (line 575), and it gains one
    `comment` node. Queries: `(comment) @comment` (highlights) and the JSDoc injection now also match such comments.
  - `test/examples/known-failures.txt`: no entry cleared (the affected inputs had no error before).
