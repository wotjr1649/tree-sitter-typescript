module github.com/wotjr1649/tree-sitter-typescript/oracle/replay

go 1.23

require (
	github.com/tree-sitter/go-tree-sitter v0.25.0
	github.com/wotjr1649/tree-sitter-typescript/v2 v2.0.0
)

require github.com/mattn/go-pointer v0.0.1 // indirect

replace github.com/wotjr1649/tree-sitter-typescript/v2 => ../..
