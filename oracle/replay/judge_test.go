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

func TestWideErrorDoesNotHoldAWellFormedToken(t *testing.T) {
	// tsc: TS1359 at byte 7 (the `in`), then TS1110 at the end. The grammar keeps `in` as a type_identifier inside one
	// wide ERROR [0,12): that ERROR must not make a complaint about `in` agree.
	src := "type A<in> ="
	nodes, r := parse(t, "typescript", src)
	if !r.HasError() {
		t.Fatalf("want an error tree, got %s", r)
	}
	at := func(n int) bool { return errorAtHolds(nodes, []byte(src), n) }
	if at(7) {
		t.Error("errorAt 7 lies inside the well-formed token `in` of a wide ERROR: must not hold")
	}
	if !at(12) {
		t.Error("errorAt 12 (the end, where the right-hand side is missing) must hold")
	}
	// An ERROR that is exactly the offending token is still the error at that token.
	nodes, r = parse(t, "tsx", "<p>></p>")
	if !errorAtHolds(nodes, []byte("<p>></p>"), 3) {
		t.Errorf("an ERROR that is the token itself must hold (%s)", r)
	}
}

func TestExactProblemNode(t *testing.T) {
	src := "let x: Foo<;"
	nodes, r := parse(t, "typescript", src)
	n := 11
	c := Case{Source: src, ErrorAt: &n, Expect: []string{"10-11:ERROR"}}
	if d := check(c, "syntax", nodes, r); len(d) != 0 {
		t.Errorf("the exact ERROR [10,11) must hold: %v", d)
	}
	c.Expect = []string{"0-11:ERROR"}
	if d := check(c, "syntax", nodes, r); len(d) != 1 {
		t.Errorf("another range must differ: %v", d)
	}
	tn, tr := parse(t, "tsx", "<p>{a && }</p>")
	m := 9
	c = Case{Source: "<p>{a && }</p>", ErrorAt: &m, Expect: []string{"8-8:MISSING:identifier"}}
	if d := check(c, "syntax", tn, tr); len(d) != 0 {
		t.Errorf("the MISSING identifier must hold: %v", d)
	}
	c.Expect = []string{"8-8:MISSING:expression"}
	if d := check(c, "syntax", tn, tr); len(d) != 1 {
		t.Errorf("another MISSING kind must differ: %v", d)
	}
	if !problemExpect("ERROR") || !problemExpect("MISSING:)") || problemExpect("MISSING:") || problemExpect("identifier") {
		t.Error("problemExpect: ERROR and MISSING:kind only")
	}
}

func TestParseCasesRefusesMalformedLines(t *testing.T) {
	ok := `{"id":"a","sha256":"x","source":"1","grammar":"typescript"}`
	if cs, err := parseCases([]byte(ok + "\n\n" + ok + "\n")); err != nil || len(cs) != 2 {
		t.Fatalf("two records and a blank line: %v %d", err, len(cs))
	}
	for name, in := range map[string]string{
		"null":             "null\n",
		"stray bracket":    ok + "\n]\n",
		"trailing garbage": ok + " x\n",
		"two on one line":  ok + ok + "\n",
		"an array":         "[]\n",
		"unknown field":    `{"id":"a","foo":1}` + "\n",
		"not json":         "{\n",
	} {
		if _, err := parseCases([]byte(in)); err == nil {
			t.Errorf("%s must be refused", name)
		}
	}
}

// copyOracle copies the committed oracle files into a temporary directory, passing each through edit.
func copyOracle(t *testing.T, edit func(name, text string) string) string {
	t.Helper()
	dir := t.TempDir()
	for _, f := range []string{"cases.jsonl", "verdicts.json", "run.mjs", "package.json", "package-lock.json"} {
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

func onlyIn(file string, edit func(string) string) func(string, string) string {
	return func(name, s string) string {
		if name == file {
			return edit(s)
		}
		return s
	}
}

// TestLoadRefusesInconsistentInputs runs load on a copy of the committed oracle with one thing broken at a time; every
// problem must be named (the substring) so that a mutation cannot be caught by an unrelated check.
func TestLoadRefusesInconsistentInputs(t *testing.T) {
	same := func(_, s string) string { return s }
	if _, _, p, err := load(copyOracle(t, same)); err != nil || len(p) != 0 {
		t.Fatalf("the committed oracle must be consistent: %v %v", err, p)
	}
	firstHash := func() string { // the sha256 of the first case record
		b, _ := os.ReadFile(filepath.Join("..", "cases.jsonl"))
		_, rest, _ := strings.Cut(string(b), `"sha256":"`)
		h, _, _ := strings.Cut(rest, `"`)
		return h
	}()
	replaceFirst := func(a, b string) func(string) string {
		return func(s string) string {
			if !strings.Contains(s, a) {
				t.Fatalf("test setup: %q not found", a)
			}
			return strings.Replace(s, a, b, 1)
		}
	}
	// the same wrong integrity in the lock and in the verdicts, as a consistent-looking drift
	const wrong = "sha512-8FYau96p"
	agreed := func(name, s string) string {
		if name == "package-lock.json" || name == "verdicts.json" {
			return strings.ReplaceAll(s, "sha512-8FYau96o", wrong)
		}
		return s
	}
	cases := []struct {
		name string
		edit func(name, text string) string
		want string
	}{
		{"a sha256 corrupted", onlyIn("cases.jsonl", replaceFirst(firstHash, strings.Repeat("0", 64))), "sha256 does not match source"},
		{"another runner", onlyIn("run.mjs", func(s string) string { return s + "// changed\n" }), "another runner"},
		{"another case set", onlyIn("cases.jsonl", func(s string) string { return s + "\n" }), "other cases"},
		{"lock says another version", onlyIn("package-lock.json", replaceFirst("\"node_modules/typescript\": {\n      \"version\": \"7.0.2\"", "\"node_modules/typescript\": {\n      \"version\": \"7.0.3\"")), "tool drift"},
		{"manifest is a range, not the exact pin", onlyIn("package.json", replaceFirst(`"typescript": "7.0.2"`, `"typescript": ">=7.0.2 <7.0.3"`)), "package.json pins"},
		{"manifest says another version", onlyIn("package.json", replaceFirst(`"typescript": "7.0.2"`, `"typescript": "7.0.3"`)), "package.json pins"},
		{"integrity changed in lock and verdicts alike", agreed, "integrity drift"},
		{"verdicts made without --noCheck", onlyIn("verdicts.json", replaceFirst(`"--noCheck",`, ``)), "tsc arguments"},
		{"no cases", onlyIn("cases.jsonl", func(string) string { return "" }), "no cases"},
	}
	for _, c := range cases {
		_, _, p, err := load(copyOracle(t, c.edit))
		if err != nil {
			t.Errorf("%s: want a named problem, got the error %v", c.name, err)
			continue
		}
		if !strings.Contains(strings.Join(p, "\n"), c.want) {
			t.Errorf("%s: want a problem containing %q, got %v", c.name, c.want, p)
		}
	}
	// malformed records are errors (exit 2), not silently ignored
	for name, tail := range map[string]string{"null": "null\n", "stray bracket": "]\n", "trailing garbage": `{"id":"z"} x` + "\n"} {
		if _, _, _, err := load(copyOracle(t, onlyIn("cases.jsonl", func(s string) string { return s + tail }))); err == nil {
			t.Errorf("%s: a malformed record must be an error", name)
		}
	}
}

func TestExactAssertionIsNeverASubstituteForErrorAt(t *testing.T) {
	// `type A<in> =`: tsc reports TS1359 at the `in` (byte 7) and TS1110 at the end (byte 12). The grammar reads `in`
	// normally inside one ERROR [0,12). Asserting that ERROR does not turn byte 7 into an agreement: the assertion shows
	// the recovery node exists, not that `in` was read as an error.
	src := "type A<in> ="
	nodes, r := parse(t, "typescript", src)
	seven := 7
	c := Case{Source: src, ErrorAt: &seven, Expect: []string{"0-12:ERROR"}}
	if d := check(c, "syntax", nodes, r); len(d) != 1 || !strings.Contains(d[0], "no ERROR or MISSING node holds byte 7") {
		t.Errorf("an exact assertion must not rescue errorAt 7: %v", d)
	}
	// the assertion is an additional check: with errorAt at the second diagnostic it passes, and a false one still differs
	twelve := 12
	c = Case{Source: src, ErrorAt: &twelve, Expect: []string{"0-12:ERROR"}}
	if d := check(c, "syntax", nodes, r); len(d) != 0 {
		t.Errorf("errorAt 12 with the true assertion must pass: %v", d)
	}
	c.Expect = []string{"0-11:ERROR"}
	if d := check(c, "syntax", nodes, r); len(d) != 1 {
		t.Errorf("a false assertion must differ: %v", d)
	}
	// Unclosed JSX `<p>x`: tsc's first diagnostic is the tag name (byte 1, TS17008), the later one is the end (byte 4,
	// TS1005). The grammar keeps `p` inside one ERROR [0,4): errorAt 1 is refused (with or without an assertion); the case
	// is registered with errorAt 4 (a later diagnostic) and a reason.
	jsx := "<p>x"
	jn, jr := parse(t, "tsx", jsx)
	one, four := 1, 4
	if d := check(Case{Source: jsx, ErrorAt: &one, Expect: []string{"0-4:ERROR"}}, "syntax", jn, jr); len(d) != 1 {
		t.Errorf("errorAt 1 stays refused even with the exact ERROR [0,4): %v", d)
	}
	if d := check(Case{Source: jsx, ErrorAt: &four, Reason: "tsc's first diagnostic (TS17008, the tag name) is inside the ERROR; the later one is the missing closing tag", Expect: []string{"0-4:ERROR"}}, "syntax", jn, jr); len(d) != 0 {
		t.Errorf("errorAt 4 must pass: %v", d)
	}
}

func TestParseCasesRulesMatchRunner(t *testing.T) {
	esc := func(hex string) string { return "\\" + "u" + hex }
	rec := func(source string) string {
		return `{"id":"a","sha256":"x","source":"` + source + `","grammar":"typescript"}`
	}
	ok := func(name, in string) {
		t.Helper()
		if _, err := parseCases([]byte(in)); err != nil {
			t.Errorf("%s must be accepted: %v", name, err)
		}
	}
	refused := func(name, in string) {
		t.Helper()
		if _, err := parseCases([]byte(in)); err == nil {
			t.Errorf("%s must be refused", name)
		}
	}
	ok("a record", rec("x")+"\n")
	ok("a valid surrogate pair", rec(esc("d83d")+esc("de00"))+"\n")
	ok("an escaped backslash before text that looks like an escape", rec("\\\\"+"ud800")+"\n")
	refused("an unpaired high surrogate", rec(esc("d800"))+"\n")
	refused("an unpaired low surrogate", rec(esc("DC00"))+"\n")
	refused("a high surrogate followed by a non-surrogate", rec(esc("d800")+esc("0041"))+"\n")
	refused("a leading BOM written as an escape", rec(esc("feff")+"x")+"\n")
	refused("a leading BOM as bytes", rec("\xef\xbb\xbfx")+"\n")
	refused("source null", `{"id":"a","sha256":"x","source":null,"grammar":"typescript"}`+"\n")
	refused("source missing", `{"id":"a","sha256":"x","grammar":"typescript"}`+"\n")
	refused("source a number", `{"id":"a","sha256":"x","source":1,"grammar":"typescript"}`+"\n")
	refused("a field name in another case", `{"id":"a","sha256":"x","SOURCE":"1","grammar":"typescript"}`+"\n")
	refused("sha256 null", `{"id":"a","sha256":null,"source":"1","grammar":"typescript"}`+"\n")
	refused("expect null", `{"id":"a","sha256":"x","source":"1","grammar":"typescript","expect":null}`+"\n")
	refused("expect with a number", `{"id":"a","sha256":"x","source":"1","grammar":"typescript","expect":[1]}`+"\n")
	refused("errorAt a string", `{"id":"a","sha256":"x","source":"1","grammar":"typescript","errorAt":"1"}`+"\n")
	refused("reason null", `{"id":"a","sha256":"x","source":"1","grammar":"typescript","reason":null}`+"\n")
	// blank lines: space, tab and CR only (the runner's rule); NEL and U+FEFF lines are not blank
	ok("blank lines of space, tab, CR", " \t\r\n\r\n"+rec("x")+"\n \n")
	refused("a NEL line", "\xc2\x85\n"+rec("x")+"\n")
	refused("a BOM line", "\xef\xbb\xbf\n"+rec("x")+"\n")
	// line numbers count every physical line, blank ones included
	if _, err := parseCases([]byte("\n\nnull\n")); err == nil || !strings.Contains(err.Error(), "line 3") {
		t.Errorf("the malformed record is on line 3, got %v", err)
	}
}

func TestLoadRefusesInvalidDiagnosticCodes(t *testing.T) {
	for name, repl := range map[string]string{"zero": "0", "null": "null", "too large": "100000", "negative": "-5"} {
		edit := onlyIn("verdicts.json", func(s string) string {
			if !strings.Contains(s, "\n    1139\n") {
				t.Fatal("test setup: code 1139 not found")
			}
			return strings.Replace(s, "\n    1139\n", "\n    "+repl+"\n", 1)
		})
		_, _, p, err := load(copyOracle(t, edit))
		if err == nil && !strings.Contains(strings.Join(p, "\n"), "small positive integer") {
			t.Errorf("%s: a diagnostic code of %s must be refused, got %v", name, repl, p)
		}
	}
}

func TestParseCasesNullsNotationAndUTF8(t *testing.T) {
	base := func(extra string) string {
		return `{"id":"a","sha256":"x","source":"1","grammar":"typescript"` + extra + "}\n"
	}
	for name, extra := range map[string]string{
		"errorAt null":          `,"errorAt":null`,
		"errorAt 0.0":           `,"errorAt":0.0`,
		"errorAt 0e0":           `,"errorAt":0e0`,
		"errorAt 1e1":           `,"errorAt":1e1`,
		"errorAt 01":            `,"errorAt":01`,
		"errorAt a string":      `,"errorAt":"0"`,
		"expect with a null":    `,"expect":[null]`,
		"expect a null element": `,"expect":["1-2:x",null]`,
		"expect null":           `,"expect":null`,
	} {
		if _, err := parseCases([]byte(base(extra))); err == nil {
			t.Errorf("%s must be refused", name)
		}
	}
	for name, extra := range map[string]string{"errorAt 0": `,"errorAt":0`, "errorAt 12": `,"errorAt":12`, "empty expect": `,"expect":[]`} {
		if cs, err := parseCases([]byte(base(extra))); err != nil || len(cs) != 1 {
			t.Errorf("%s must be accepted: %v", name, err)
		}
	}
	// a raw 0x80 byte inside a string is invalid UTF-8: refused, not turned into U+FFFD
	if _, err := parseCases([]byte("{\"id\":\"a\",\"sha256\":\"x\",\"source\":\"void \x80;\",\"grammar\":\"typescript\"}\n")); err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Errorf("invalid UTF-8 must be refused, got %v", err)
	}
	// valid multi-byte text is fine
	if _, err := parseCases([]byte("{\"id\":\"a\",\"sha256\":\"x\",\"source\":\"한글😀\",\"grammar\":\"typescript\"}\n")); err != nil {
		t.Errorf("valid UTF-8 must be accepted: %v", err)
	}
}
