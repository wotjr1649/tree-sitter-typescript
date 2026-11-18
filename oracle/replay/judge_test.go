package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func parse(t *testing.T, grammar, src string) ([]node, Report) {
	t.Helper()
	ps, err := newParsers()
	if err != nil {
		t.Fatal(err)
	}
	defer ps.close()
	nodes, r, err := ps.judge(grammar, src)
	if err != nil {
		t.Fatal(err)
	}
	return nodes, r
}

func TestCleanTreeAndExpect(t *testing.T) {
	src := "f<T>(x)"
	nodes, r := parse(t, "typescript", src)
	if !r.Clean() {
		t.Fatalf("want a clean tree, got %s", r)
	}
	if got := deepest(nodes, 2, 3); got != "type_identifier" {
		t.Errorf("deepest(2,3) = %q", got)
	}
	ok := Case{Source: src, Expect: []string{"2-3:type_identifier"}}
	if d := check(ok, "accept", nodes, r); len(d) != 0 {
		t.Errorf("unexpected differences: %v", d)
	}
	flipped := Case{Source: src, Expect: []string{"2-3:identifier"}}
	if d := check(flipped, "accept", nodes, r); len(d) != 1 {
		t.Errorf("a flipped expectation must differ, got %v", d)
	}
}

func TestAnonymousKindInExpect(t *testing.T) {
	// Anonymous tokens (keywords, punctuation) are nodes too: a snapshot or expect entry can name them.
	nodes, r := parse(t, "typescript", "a = b;")
	if !r.Clean() {
		t.Fatalf("want a clean tree, got %s", r)
	}
	if got := deepest(nodes, 2, 3); got != "=" {
		t.Errorf("deepest(2,3) = %q, want the anonymous =", got)
	}
}

func TestAcceptedAndErrorIsRefused(t *testing.T) {
	nodes, r := parse(t, "typescript", "let x = ;")
	if !r.HasError() {
		t.Fatalf("want an error tree, got %s", r)
	}
	d := check(Case{Source: "let x = ;"}, "accept", nodes, r)
	if len(d) != 1 || !strings.Contains(d[0], "accepted by tsc but the tree has an error") {
		t.Errorf("an accepted case with an error tree must differ, got %v", d)
	}
}

func TestGrammarsDiffer(t *testing.T) {
	// `<div>a</div>` is JSX in tsx and an error in typescript (a type assertion without an operand).
	if _, r := parse(t, "tsx", "const x = <div>a</div>;"); !r.Clean() {
		t.Errorf("tsx must parse JSX: %s", r)
	}
	if _, r := parse(t, "typescript", "const x = <div>a</div>;"); !r.HasError() {
		t.Errorf("typescript must not parse JSX: %s", r)
	}
}

func TestSyntaxPosition(t *testing.T) {
	src := "let x = ;"
	nodes, r := parse(t, "typescript", src)
	if !r.HasError() {
		t.Fatalf("want an error tree, got %s", r)
	}
	at := func(n int) []string { return check(Case{Source: src, ErrorAt: &n}, "syntax", nodes, r) }
	if d := at(8); len(d) != 0 { // the ';' tsc names
		t.Errorf("errorAt 8 should hold: %v", d)
	}
	if d := at(0); len(d) != 1 { // before every problem node
		t.Errorf("errorAt 0 should not hold")
	}
	// a clean tree for a syntax verdict differs
	cn, cr := parse(t, "typescript", "let x = 1;")
	n := 8
	if d := check(Case{Source: "let x = 1;", ErrorAt: &n}, "syntax", cn, cr); len(d) != 1 {
		t.Errorf("a clean tree for a syntax verdict must differ: %v", d)
	}
}

func TestErrorAtAcrossWhitespace(t *testing.T) {
	// ERROR ends at 9, tsc names the next token at 10: only whitespace in between.
	src := []byte("{ using = ; }")
	nodes := []node{{kind: "ERROR", start: 2, end: 9, err: true, leaf: true}}
	if !errorAtHolds(nodes, src, 10) {
		t.Error("whitespace between the ERROR end and the offset must be tolerated")
	}
	if errorAtHolds(nodes, []byte("{ using =x; }"), 10) {
		t.Error("a non-whitespace byte between the ERROR end and the offset must not be tolerated")
	}
}

func TestCoverageAndZeroWidth(t *testing.T) {
	src := []byte("a  ;")
	leaf := func(k string, s, e int) node { return node{kind: k, start: s, end: e, depth: 1, leaf: true} }
	root := node{kind: "program", start: 0, end: 4}
	if r := analyze([]node{root, leaf("identifier", 0, 1), leaf(";", 3, 4)}, false, src); !r.Clean() {
		t.Errorf("whitespace gaps are covered: %s", r)
	}
	if r := analyze([]node{root, leaf("identifier", 0, 1)}, false, src); r.FirstUncovered != 3 || r.Clean() {
		t.Errorf("the uncovered ';' must be found: %+v", r)
	}
	zero := leaf("x", 1, 1)
	if r := analyze([]node{root, leaf("identifier", 0, 1), zero, leaf(";", 3, 4)}, false, src); r.ZeroWidth != 1 || r.Clean() {
		t.Errorf("a zero-width node must be reported: %+v", r)
	}
	miss := leaf(")", 1, 1)
	miss.missing = true
	if r := analyze([]node{root, leaf("identifier", 0, 1), miss, leaf(";", 3, 4)}, true, src); r.Missing != 1 || r.ZeroWidth != 0 || !r.HasError() {
		t.Errorf("a MISSING node counts once, as missing: %+v", r)
	}
}

func TestParseExpect(t *testing.T) {
	for _, bad := range []string{"", "3-9", "9-3:x", "a-b:x", "3-9:", "-1-4:x"} {
		if _, _, _, err := parseExpect(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
	if s, e, k, err := parseExpect("3-9:property_identifier"); err != nil || s != 3 || e != 9 || k != "property_identifier" {
		t.Errorf("parseExpect: %d %d %q %v", s, e, k, err)
	}
	if _, _, k, err := parseExpect("7-10:out"); err != nil || k != "out" {
		t.Errorf("an anonymous kind must parse: %q %v", k, err)
	}
}

// TestLoadRefusesInconsistentInputs runs load on a copy of the committed oracle with one thing broken at a time.
func TestLoadRefusesInconsistentInputs(t *testing.T) {
	files := []string{"cases.jsonl", "verdicts.json", "run.mjs", "package-lock.json"}
	copyTo := func(edit func(name, text string) string) string {
		dir := t.TempDir()
		for _, f := range files {
			b, err := os.ReadFile(filepath.Join("..", f))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, f), []byte(edit(f, string(b))), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		return dir
	}
	same := func(_, s string) string { return s }
	if _, _, p, err := load(copyTo(same)); err != nil || len(p) != 0 {
		t.Fatalf("the committed oracle must be consistent: %v %v", err, p)
	}
	firstHash := func() string { // the sha256 of the first case record
		b, _ := os.ReadFile(filepath.Join("..", "cases.jsonl"))
		_, rest, _ := strings.Cut(string(b), `"sha256":"`)
		h, _, _ := strings.Cut(rest, `"`)
		return h
	}()
	broken := map[string]func(name, text string) string{
		"a sha256 corrupted": func(n, s string) string {
			if n == "cases.jsonl" {
				return strings.Replace(s, firstHash, strings.Repeat("0", 64), 1)
			}
			return s
		},
		"another runner": func(n, s string) string {
			if n == "run.mjs" {
				return s + "// changed\n"
			}
			return s
		},
		"tool version drift": func(n, s string) string {
			if n == "package-lock.json" {
				return strings.Replace(s, "\"node_modules/typescript\": {\n      \"version\": \"7.0.2\"", "\"node_modules/typescript\": {\n      \"version\": \"7.0.3\"", 1)
			}
			return s
		},
		"integrity drift": func(n, s string) string {
			if n == "package-lock.json" {
				return strings.Replace(s, "sha512-8FYau96o", "sha512-8FYau96p", 1)
			}
			return s
		},
		"a verdict of another case set": func(n, s string) string {
			if n == "cases.jsonl" {
				return s + "\n"
			}
			return s
		},
	}
	for name, edit := range broken {
		if _, _, p, err := load(copyTo(edit)); err != nil || len(p) == 0 {
			t.Errorf("%s: want inconsistent-input problems, got %v %v", name, p, err)
		}
	}
}
