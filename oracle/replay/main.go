// Command replay judges tsc's verdicts against both grammars through the tree-sitter API.
//
//	go run . [-oracle DIR] [-tree]     replay oracle/verdicts.json
//	go run . -judge FILE               print the tree-sitter judgement of every record of FILE (no verdicts)
//
// Exit codes: 0 every case is consistent; 1 a result differs (listed); 2 the inputs are inconsistent (hash mismatch,
// verdicts made from other cases, another runner or another tool version, a malformed case) or nothing could be
// judged. See oracle/README.md.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_typescript "github.com/wotjr1649/tree-sitter-typescript/bindings/go"
)

// The oracle the replay accepts, written down here and not read back from the files under test: run.mjs pins the same
// values, and changing the tool means changing both (see oracle/README.md).
const (
	toolPackage   = "typescript"
	toolVersion   = "7.0.2"
	toolIntegrity = "sha512-8FYau96o3NKOhbjKi/qNvG/W5jhzxkbdm5sj9AbZ/5T5sWqn3hJgLfGx27sRKZWTvyzCP8dLRBTf5tBTSRVUNA=="
)

var toolArguments = []string{"--noEmit", "--noCheck", "--pretty", "false", "--target", "esnext", "--jsx", "preserve"}

type verdictFile struct {
	Meta struct {
		Format       int      `json:"format"`
		Tool         string   `json:"tool"`
		Package      string   `json:"package"`
		Version      string   `json:"version"`
		Integrity    string   `json:"integrity"`
		LockSHA256   string   `json:"package_lock_sha256"`
		Arguments    []string `json:"arguments"`
		Encoding     string   `json:"encoding"`
		CasesSHA256  string   `json:"cases_sha256"`
		RunnerSHA256 string   `json:"runner_sha256"`
	} `json:"meta"`
	Results []verdict `json:"results"`
}

type verdict struct {
	ID      string `json:"id"`
	SHA256  string `json:"sha256"`
	Grammar string `json:"grammar"`
	Verdict string `json:"verdict"`
	Codes   []int  `json:"codes"`
	At      *int   `json:"at"` // first diagnostic, UTF-8 byte offset
}

type lockFile struct {
	Packages map[string]struct {
		Version      string            `json:"version"`
		Integrity    string            `json:"integrity"`
		Dependencies map[string]string `json:"dependencies"`
	} `json:"packages"`
}

func sum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

// parseCases reads cases.jsonl with the same rules as run.mjs (a malformed file is exit 2 in both tools): lines are split
// at \n only; a line of only space, tab and CR is blank; line numbers count every physical line; every other line is
// exactly one JSON object; field names are exact (case-sensitive, Go's own decoder would ignore case); id, sha256,
// source and grammar are strings and not null; source has no unpaired surrogate escape (Go would turn it into U+FFFD)
// and no leading U+FEFF; expect is an array of strings, errorAt an integer, reason a string.
func parseCases(b []byte) ([]Case, error) {
	// Invalid UTF-8 would be turned into U+FFFD by the JSON decoder (and by run.mjs), changing the bytes that are judged.
	if !utf8.Valid(b) {
		return nil, fmt.Errorf("cases.jsonl is not valid UTF-8")
	}
	var cases []Case
	for n, line := range strings.Split(string(b), "\n") {
		if strings.Trim(line, " \t\r") == "" {
			continue
		}
		c, err := parseCase(line)
		if err != nil {
			return nil, fmt.Errorf("cases.jsonl line %d: %w", n+1, err)
		}
		cases = append(cases, c)
	}
	return cases, nil
}

var plainInteger = regexp.MustCompile(`^-?(0|[1-9][0-9]*)$`)

func parseCase(line string) (Case, error) {
	var c Case
	if !strings.HasPrefix(strings.Trim(line, " \t\r"), "{") {
		return c, fmt.Errorf("a record must be a JSON object")
	}
	dec := json.NewDecoder(strings.NewReader(line))
	var raw map[string]json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		return c, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return c, fmt.Errorf("data after the record")
	}
	str := func(key string, dst *string) error {
		v, ok := raw[key]
		if !ok {
			return fmt.Errorf("%s must be a string (missing)", key)
		}
		if err := json.Unmarshal(v, dst); err != nil || string(bytes.TrimSpace(v)) == "null" {
			return fmt.Errorf("%s must be a string", key)
		}
		return nil
	}
	for k := range raw {
		switch k {
		case "id", "sha256", "source", "grammar", "expect", "errorAt", "reason":
		default:
			return c, fmt.Errorf("unknown field %s", k)
		}
	}
	for key, dst := range map[string]*string{"id": &c.ID, "sha256": &c.SHA256, "source": &c.Source, "grammar": &c.Grammar} {
		if err := str(key, dst); err != nil {
			return c, err
		}
	}
	if hasUnpairedSurrogate(raw["source"]) {
		return c, fmt.Errorf("source has an unpaired surrogate")
	}
	if strings.HasPrefix(c.Source, "\xef\xbb\xbf") {
		return c, fmt.Errorf("source must not start with a BOM (tsc strips it and the offsets would shift)")
	}
	if v, ok := raw["reason"]; ok {
		if err := str("reason", &c.Reason); err != nil || len(v) == 0 {
			return c, fmt.Errorf("reason must be a string")
		}
	}
	if v, ok := raw["expect"]; ok {
		var items []json.RawMessage // not []string: a null element would decode silently to ""
		if err := json.Unmarshal(v, &items); err != nil || items == nil {
			return c, fmt.Errorf("expect must be an array of strings")
		}
		c.Expect = []string{}
		for _, item := range items {
			var e string
			if string(bytes.TrimSpace(item)) == "null" || json.Unmarshal(item, &e) != nil {
				return c, fmt.Errorf("expect must be an array of strings")
			}
			c.Expect = append(c.Expect, e)
		}
	}
	if v, ok := raw["errorAt"]; ok {
		// null is refused, and so is every notation but plain integer digits (0.0 and 0e0 are refused, as in run.mjs).
		var at int
		if !plainInteger.Match(bytes.TrimSpace(v)) || json.Unmarshal(v, &at) != nil {
			return c, fmt.Errorf("errorAt must be an integer written as plain digits")
		}
		c.ErrorAt = &at
	}
	return c, nil
}

// hasUnpairedSurrogate scans the raw JSON text of a string for \uD800-\uDFFF escapes that are not a high surrogate
// followed by a low one.
func hasUnpairedSurrogate(raw json.RawMessage) bool {
	hex4 := func(i int) (rune, bool) {
		if i+6 > len(raw) || raw[i] != '\\' || raw[i+1] != 'u' {
			return 0, false
		}
		var r rune
		for _, c := range raw[i+2 : i+6] {
			switch {
			case c >= '0' && c <= '9':
				r = r<<4 | rune(c-'0')
			case c >= 'a' && c <= 'f':
				r = r<<4 | rune(c-'a'+10)
			case c >= 'A' && c <= 'F':
				r = r<<4 | rune(c-'A'+10)
			default:
				return 0, false
			}
		}
		return r, true
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		if r, ok := hex4(i); ok && r >= 0xD800 && r <= 0xDFFF {
			if r >= 0xDC00 {
				return true
			}
			if low, ok := hex4(i + 6); !ok || low < 0xDC00 || low > 0xDFFF {
				return true
			}
			i += 11
			continue
		}
		i++ // skip the escaped character
	}
	return false
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// load reads and cross-checks every input; the returned problems mean exit 2.
func load(dir string) (cases []Case, verdicts map[string]verdict, problems []string, err error) {
	casesBytes, err := os.ReadFile(filepath.Join(dir, "cases.jsonl"))
	if err != nil {
		return nil, nil, nil, err
	}
	var vf verdictFile
	if err = readJSON(filepath.Join(dir, "verdicts.json"), &vf); err != nil {
		return nil, nil, nil, err
	}
	lockBytes, err := os.ReadFile(filepath.Join(dir, "package-lock.json"))
	if err != nil {
		return nil, nil, nil, err
	}
	var lock lockFile
	if err = json.Unmarshal(lockBytes, &lock); err != nil {
		return nil, nil, nil, err
	}
	runner, err := os.ReadFile(filepath.Join(dir, "run.mjs"))
	if err != nil {
		return nil, nil, nil, err
	}
	var manifest struct {
		Dependencies map[string]string `json:"dependencies"`
	}
	if err = readJSON(filepath.Join(dir, "package.json"), &manifest); err != nil {
		return nil, nil, nil, err
	}
	records, err := parseCases(casesBytes)
	if err != nil {
		return nil, nil, nil, err
	}
	bad := func(f string, a ...any) { problems = append(problems, fmt.Sprintf(f, a...)) }

	m := vf.Meta
	if m.Format != 1 || m.Encoding != "utf-8" || m.Tool != "tsc" {
		bad("verdicts.json: unsupported format %d / encoding %q / tool %q", m.Format, m.Encoding, m.Tool)
	}
	if m.CasesSHA256 != sum(casesBytes) {
		bad("verdicts.json was made from other cases (cases_sha256 %s, cases.jsonl %s)", m.CasesSHA256, sum(casesBytes))
	}
	if m.RunnerSHA256 != sum(runner) {
		bad("verdicts.json was made by another runner (runner_sha256 %s, run.mjs %s)", m.RunnerSHA256, sum(runner))
	}
	if m.LockSHA256 != sum(lockBytes) {
		bad("verdicts.json was made with another package-lock.json (package_lock_sha256 %s, file %s)", m.LockSHA256, sum(lockBytes))
	}
	// Tool drift: the verdicts, the lockfile and the manifest are each compared with the values written down above, not
	// only with each other: the version, its exact pin in package.json (and the lock's copy of it), the npm integrity
	// and the tsc arguments. Every platform binary package the lock holds must be that version too.
	e := lock.Packages["node_modules/"+toolPackage]
	if m.Package != toolPackage || m.Version != toolVersion || e.Version != toolVersion {
		bad("tool drift: verdicts have %s %s, package-lock.json has %q, the replay expects %s %s", m.Package, m.Version, e.Version, toolPackage, toolVersion)
	}
	if pin := manifest.Dependencies[toolPackage]; pin != toolVersion || lock.Packages[""].Dependencies[toolPackage] != toolVersion {
		bad("package.json pins %s %q and package-lock.json's root %q, the replay expects exactly %q", toolPackage, pin, lock.Packages[""].Dependencies[toolPackage], toolVersion)
	}
	if m.Integrity != toolIntegrity || e.Integrity != toolIntegrity {
		bad("integrity drift: verdicts have %q, package-lock.json has %q, the replay expects %q", m.Integrity, e.Integrity, toolIntegrity)
	}
	if !slices.Equal(m.Arguments, toolArguments) {
		bad("verdicts.json was made with the tsc arguments %q, the replay expects %q", m.Arguments, toolArguments)
	}
	for name, p := range lock.Packages {
		if strings.HasPrefix(name, "node_modules/@typescript/typescript-") && p.Version != toolVersion {
			bad("package-lock.json: %s is %s, not %s", name, p.Version, toolVersion)
		}
	}

	verdicts = map[string]verdict{}
	byID := map[string]verdict{}
	for _, r := range vf.Results {
		if _, dup := byID[r.ID]; dup {
			bad("verdicts.json: duplicate id %s", r.ID)
		}
		byID[r.ID] = r
	}
	if len(records) == 0 {
		bad("cases.jsonl holds no cases: an empty oracle checks nothing")
	}
	seen := map[string]bool{}
	for _, c := range records {
		if seen[c.ID] || c.ID == "" {
			bad("cases.jsonl: empty or duplicate id %q", c.ID)
		}
		seen[c.ID] = true
		if c.Grammar != "typescript" && c.Grammar != "tsx" {
			bad("%s: grammar must be typescript or tsx, got %q", c.ID, c.Grammar)
		}
		if c.SHA256 != sum([]byte(c.Source)) {
			bad("%s: sha256 does not match source", c.ID)
		}
		v, ok := byID[c.ID]
		switch {
		case !ok:
			bad("%s: no verdict", c.ID)
		case v.SHA256 != c.SHA256 || v.Grammar != c.Grammar:
			bad("%s: verdict made from other bytes or another grammar", c.ID)
		}
		verdicts[c.ID] = v
		for _, e := range c.Expect {
			if _, _, _, err := parseExpect(e); err != nil {
				bad("%s: %v", c.ID, err)
			}
		}
		if ok {
			switch v.Verdict {
			case "accept":
				if len(v.Codes) != 0 || v.At != nil {
					bad("%s: an accept verdict carries diagnostics", c.ID)
				}
			case "syntax":
				if len(v.Codes) == 0 || v.At == nil || *v.At < 0 || *v.At > len(c.Source) {
					bad("%s: a syntax verdict needs diagnostics and a position inside the source", c.ID)
				}
				for _, code := range v.Codes { // the runner accepts 1..99999 only (a JSON null decodes to 0)
					if code < 1 || code > 99999 {
						bad("%s: diagnostic code %d is not a small positive integer", c.ID, code)
					}
				}
			default:
				bad("%s: unknown verdict %q", c.ID, v.Verdict)
			}
			// accept: expect names the deepest node's kind; syntax: expect names the exact ERROR / MISSING node.
			for _, e := range c.Expect {
				if _, _, kind, err := parseExpect(e); err == nil && problemExpect(kind) != (v.Verdict == "syntax") {
					bad("%s: expect %s does not fit a %s verdict (ERROR and MISSING:kind entries fit syntax cases only)", c.ID, e, v.Verdict)
				}
			}
			if (c.ErrorAt != nil) != (v.Verdict == "syntax") {
				bad("%s: errorAt is required for, and only fits, a syntax verdict (verdict %s)", c.ID, v.Verdict)
			}
			if c.ErrorAt != nil && v.At != nil {
				if *c.ErrorAt < 0 || *c.ErrorAt > len(c.Source) {
					bad("%s: errorAt %d is outside the source (%d bytes)", c.ID, *c.ErrorAt, len(c.Source))
				}
				// errorAt is tsc's first diagnostic unless the case says why it is another position.
				if (*c.ErrorAt != *v.At) != (c.Reason != "") {
					bad("%s: errorAt %d, tsc's first diagnostic %d: a reason is required exactly when they differ", c.ID, *c.ErrorAt, *v.At)
				}
			}
			if c.ErrorAt == nil && c.Reason != "" {
				bad("%s: a reason only fits a syntax case with its own errorAt", c.ID)
			}
		}
		cases = append(cases, c)
	}
	for id := range byID {
		if !seen[id] {
			bad("verdicts.json has %s, which cases.jsonl does not", id)
		}
	}
	sort.Strings(problems)
	return cases, verdicts, problems, nil
}

func language(grammar string) (*tree_sitter.Language, error) {
	switch grammar {
	case "typescript":
		return tree_sitter.NewLanguage(tree_sitter_typescript.LanguageTypescript()), nil
	case "tsx":
		return tree_sitter.NewLanguage(tree_sitter_typescript.LanguageTSX()), nil
	}
	return nil, fmt.Errorf("unknown grammar %q", grammar)
}

// parsers loads both grammars once.
type parsers map[string]*tree_sitter.Parser

func newParsers() (parsers, error) {
	ps := parsers{}
	for _, g := range []string{"typescript", "tsx"} {
		lang, err := language(g)
		if err != nil {
			return nil, err
		}
		p := tree_sitter.NewParser()
		if err := p.SetLanguage(lang); err != nil {
			return nil, fmt.Errorf("cannot load the %s grammar: %w", g, err)
		}
		ps[g] = p
	}
	return ps, nil
}

func (ps parsers) close() {
	for _, p := range ps {
		p.Close()
	}
}

// judge parses one source with the grammar's parser.
func (ps parsers) judge(grammar string, source string) ([]node, Report, error) {
	p, ok := ps[grammar]
	if !ok {
		return nil, Report{}, fmt.Errorf("unknown grammar %q", grammar)
	}
	src := []byte(source)
	tree := p.Parse(src, nil)
	if tree == nil {
		return nil, Report{}, fmt.Errorf("parse returned no tree")
	}
	defer tree.Close()
	nodes := flatten(tree.RootNode())
	return nodes, analyze(nodes, tree.RootNode().HasError(), src), nil
}

func main() { os.Exit(run()) }

func run() int {
	dir := flag.String("oracle", "..", "the oracle directory (cases.jsonl, verdicts.json, run.mjs, package-lock.json)")
	showTree := flag.Bool("tree", false, "print every case's tree with byte ranges (for writing expect entries)")
	judgeFile := flag.String("judge", "", "judge every record (id, grammar, source) of this JSON Lines file and print one JSON line each; no verdicts")
	flag.Parse()

	ps, err := newParsers()
	if err != nil {
		fmt.Fprintln(os.Stderr, "replay:", err)
		return 2
	}
	defer ps.close()

	if *judgeFile != "" {
		return judgeOnly(ps, *judgeFile, *showTree)
	}

	cases, verdicts, problems, err := load(*dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "replay:", err)
		return 2
	}
	if len(problems) > 0 {
		fmt.Println("INCONSISTENT INPUTS:")
		for _, p := range problems {
			fmt.Println("  " + p)
		}
		return 2
	}

	var differ []string
	tally := map[string]int{}
	for _, c := range cases {
		nodes, r, err := ps.judge(c.Grammar, c.Source)
		if err != nil {
			fmt.Fprintf(os.Stderr, "replay: %s: %v\n", c.ID, err)
			return 2
		}
		v := verdicts[c.ID].Verdict
		diffs := check(c, v, nodes, r)
		status := "ok"
		if len(diffs) > 0 {
			status = "DIFF"
			for _, d := range diffs {
				differ = append(differ, c.ID+": "+d)
			}
		}
		tally[c.Grammar+" "+v+" "+status]++
		fmt.Printf("%-4s %-6s %-10s %s  %s\n", status, v, c.Grammar, c.ID, r)
		if *showTree {
			for _, n := range nodes {
				fmt.Printf("     %*s%s %d-%d\n", 2*n.depth, "", n.kind, n.start, n.end)
			}
		}
	}

	keys := make([]string, 0, len(tally))
	for k := range tally {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Printf("\n%d cases:", len(cases))
	for _, k := range keys {
		fmt.Printf(" [%s %d]", k, tally[k])
	}
	fmt.Println()
	if len(differ) > 0 {
		fmt.Println("\nRESULTS DIFFER:")
		for _, d := range differ {
			fmt.Println("  " + d)
		}
		return 1
	}
	return 0
}

// judgeOnly prints the tree-sitter judgement of every record of a JSON Lines file: {"id","grammar","class","first",
// "errorStart"}, class clean|error|defect (see Report.String).
func judgeOnly(ps parsers, path string, showTree bool) int {
	b, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "replay:", err)
		return 2
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	enc := json.NewEncoder(os.Stdout)
	for dec.More() {
		var c Case
		if err := dec.Decode(&c); err != nil {
			fmt.Fprintln(os.Stderr, "replay:", err)
			return 2
		}
		nodes, r, err := ps.judge(c.Grammar, c.Source)
		if err != nil {
			fmt.Fprintf(os.Stderr, "replay: %s: %v\n", c.ID, err)
			return 2
		}
		class := "clean"
		switch {
		case r.HasError():
			class = "error"
		case !r.Clean():
			class = "defect"
		}
		errStart := -1
		for _, n := range nodes {
			if n.err || n.missing {
				errStart = n.start
				break
			}
		}
		_ = enc.Encode(map[string]any{"id": c.ID, "grammar": c.Grammar, "class": class, "first": r.First, "errorStart": errStart})
		if showTree {
			for _, n := range nodes {
				fmt.Fprintf(os.Stderr, "%*s%s %d-%d\n", 2*n.depth, "", n.kind, n.start, n.end)
			}
		}
	}
	return 0
}
