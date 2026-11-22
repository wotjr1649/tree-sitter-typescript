package tree_sitter_typescript_test

import (
	"strings"
	"testing"
	"unsafe"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_typescript "github.com/wotjr1649/tree-sitter-typescript/v2/bindings/go"
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

// The edit can reuse a declaration or yield subtree without reentering the lexer state that saw its trailing trivia.
func TestLookaheadAfterSubtreeReuse(t *testing.T) {
	for _, grammar := range []struct {
		name string
		lang unsafe.Pointer
	}{
		{"typescript", tree_sitter_typescript.LanguageTypescript()},
		{"tsx", tree_sitter_typescript.LanguageTSX()},
	} {
		t.Run(grammar.name, func(t *testing.T) {
			language := tree_sitter.NewLanguage(grammar.lang)
			for _, c := range []struct{ name, prefix, suffix, insertion string }{
				{"bare declarator", "", "let x/*\n*/+y", " "},
				{"typed bare declarator", "", "let x: T/*\n*/+y", " "},
				{"bare yield ASI", "function* g(){return ", "yield yield\n(x);}", "/*review\n*/"},
				{"comparison before prefix decrement", "a", "/*\n*/<!--x\n+b", " "},
				{"initializer before prefix increment", "let", " a=b/**//*\u2028*/++c", " "},
				{"initializer before prefix decrement", "let", " a=b//\u2029--c", " "},
				{"declarator before line comment", "let a=b", "\nlet d=e//\nc;d;", " "},
				{"initializer before comment at EOF", "let", " a=b//", " "},
			} {
				t.Run(c.name, func(t *testing.T) {
					parser := tree_sitter.NewParser()
					defer parser.Close()
					if err := parser.SetLanguage(language); err != nil {
						t.Fatal(err)
					}
					old := parser.Parse([]byte(c.prefix+c.suffix), nil)
					defer old.Close()
					prefix := c.prefix + c.insertion
					start := tree_sitter.Point{Column: uint(len(c.prefix))}
					end := tree_sitter.Point{
						Row:    uint(strings.Count(prefix, "\n")),
						Column: uint(len(prefix) - 1 - strings.LastIndexByte(prefix, '\n')),
					}
					old.Edit(&tree_sitter.InputEdit{
						StartByte: uint(len(c.prefix)), OldEndByte: uint(len(c.prefix)), NewEndByte: uint(len(prefix)),
						StartPosition: start, OldEndPosition: start, NewEndPosition: end,
					})
					source := []byte(prefix + c.suffix)
					incremental := parser.Parse(source, old)
					defer incremental.Close()
					fresh := parser.Parse(source, nil)
					defer fresh.Close()
					if got, want := incremental.RootNode().ToSexp(), fresh.RootNode().ToSexp(); fresh.RootNode().HasError() || got != want {
						t.Fatalf("incremental: %s\nfresh: %s", got, want)
					}
				})
			}
		})
	}
}
