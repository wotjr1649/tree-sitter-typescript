package tree_sitter_typescript_test

import (
	"testing"
	"unsafe"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_typescript "github.com/wotjr1649/tree-sitter-typescript/bindings/go"
)

func parse(t *testing.T, lang unsafe.Pointer, src string) {
	t.Helper()
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(tree_sitter.NewLanguage(lang)); err != nil {
		t.Fatalf("Error loading grammar: %v", err)
	}
	tree := parser.Parse([]byte(src), nil)
	defer tree.Close()
	if tree.RootNode().HasError() {
		t.Errorf("unexpected error node parsing %q", src)
	}
}

func TestCanLoadTypescriptGrammar(t *testing.T) {
	parse(t, tree_sitter_typescript.LanguageTypescript(), "let x: number = 1;")
}

func TestCanLoadTSXGrammar(t *testing.T) {
	parse(t, tree_sitter_typescript.LanguageTSX(), "const a = <div />;")
}
