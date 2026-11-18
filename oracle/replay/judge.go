package main

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
)

// Case is one record of oracle/cases.jsonl.
type Case struct {
	ID      string   `json:"id"`
	SHA256  string   `json:"sha256"`
	Source  string   `json:"source"`
	Grammar string   `json:"grammar"` // typescript (.ts) or tsx (.tsx)
	Expect  []string `json:"expect"`  // accept cases: "s-e:kind", the deepest node covering bytes [s,e) has this kind
	ErrorAt *int     `json:"errorAt"` // syntax cases: decided error position, a UTF-8 byte offset
	Reason  string   `json:"reason"`  // syntax cases whose errorAt is not tsc's first position: why
}

// node is one tree node in document (preorder) order.
type node struct {
	kind       string
	start, end int
	depth      int
	leaf       bool
	err        bool // kind ERROR
	missing    bool
}

// Report is the tree-sitter API's judgement of one parse.
type Report struct {
	RootHasError   bool
	Errors         int // ERROR nodes
	Missing        int // MISSING nodes
	ZeroWidth      int // zero-width nodes other than MISSING
	FirstUncovered int // first byte outside every leaf and not a gap character, -1 when the input is covered
	First          string
}

// Clean means the tree is a faithful parse: no error of any kind, no zero-width node, every byte covered.
func (r Report) Clean() bool {
	return !r.RootHasError && r.Errors == 0 && r.Missing == 0 && r.ZeroWidth == 0 && r.FirstUncovered < 0
}

func (r Report) HasError() bool { return r.RootHasError || r.Errors > 0 || r.Missing > 0 }

func (r Report) String() string {
	switch {
	case r.Clean():
		return "clean"
	case r.HasError():
		return "error " + r.First
	}
	return "defect " + r.First
}

// flatten lists the tree in document order with depths, through the API (Child by index sees extras and anonymous nodes).
func flatten(root *tree_sitter.Node) []node {
	var out []node
	var walk func(n *tree_sitter.Node, depth int)
	walk = func(n *tree_sitter.Node, depth int) {
		out = append(out, node{
			kind: n.Kind(), start: int(n.StartByte()), end: int(n.EndByte()), depth: depth,
			leaf: n.ChildCount() == 0, err: n.IsError(), missing: n.IsMissing(),
		})
		for i := uint(0); i < n.ChildCount(); i++ {
			walk(n.Child(i), depth+1)
		}
	}
	walk(root, 0)
	return out
}

// isGap reports whether a rune may sit between tokens without belonging to a node: Unicode White_Space plus the
// zero-width characters of the grammar's extras (U+FEFF, U+200B, U+2060; third_party/.../grammar.js).
func isGap(r rune) bool {
	return unicode.IsSpace(r) || r == 0xFEFF || r == 0x200B || r == 0x2060
}

// firstUncovered returns the first byte that lies outside every leaf (MISSING leaves cover nothing) and is not a gap
// character, or -1. Leaves are in document order, so one pass is enough.
func firstUncovered(nodes []node, src []byte) int {
	pos := 0
	gap := func(to int) int { // first non-gap byte of src[pos:to], or -1
		for i := pos; i < to; {
			r, size := utf8.DecodeRune(src[i:])
			if r == utf8.RuneError && size <= 1 || !isGap(r) {
				return i
			}
			i += size
		}
		return -1
	}
	for _, n := range nodes {
		if !n.leaf || n.missing || n.start == n.end {
			continue
		}
		if n.start < pos { // leaves overlap: the tree is not a partition of the input
			return n.start
		}
		if i := gap(n.start); i >= 0 {
			return i
		}
		pos = n.end
	}
	return gap(len(src))
}

// analyze judges a flattened tree. The CLI's parse summary is never used: it can call a tree with ERROR or only
// zero-width nodes a success.
func analyze(nodes []node, rootHasError bool, src []byte) Report {
	r := Report{RootHasError: rootHasError, FirstUncovered: firstUncovered(nodes, src)}
	problem := func(what string, n node) {
		if r.First == "" {
			r.First = fmt.Sprintf("%s %s [%d,%d)", what, n.kind, n.start, n.end)
		}
	}
	for _, n := range nodes {
		switch {
		case n.err:
			r.Errors++
			problem("ERROR", n)
		case n.missing:
			r.Missing++
			problem("MISSING", n)
		case n.start == n.end && n.depth > 0: // an empty program is a zero-width root, not a defect
			r.ZeroWidth++
			problem("zero-width", n)
		}
	}
	if r.First == "" && rootHasError {
		r.First = "root has_error without an ERROR or MISSING node"
	}
	if r.First == "" && r.FirstUncovered >= 0 {
		r.First = fmt.Sprintf("uncovered byte %d", r.FirstUncovered)
	}
	return r
}

// parseExpect splits "s-e:kind". The kind may be an anonymous node's text (for example "out" or "&").
func parseExpect(e string) (start, end int, kind string, err error) {
	span, kind, ok := strings.Cut(e, ":")
	a, b, ok2 := strings.Cut(span, "-")
	start, err1 := strconv.Atoi(a)
	end, err2 := strconv.Atoi(b)
	if !ok || !ok2 || err1 != nil || err2 != nil || kind == "" || start < 0 || end < start {
		return 0, 0, "", fmt.Errorf("bad expect entry %q (want s-e:kind)", e)
	}
	return start, end, kind, nil
}

// deepest returns the kind of the deepest node covering bytes [start,end), the first one in document order among
// equals (the rule of go-treesitter's korean manifest), or "" when none covers it.
func deepest(nodes []node, start, end int) string {
	best, kind := -1, ""
	for _, n := range nodes {
		if n.start <= start && n.end >= end && n.depth > best {
			best, kind = n.depth, n.kind
		}
	}
	return kind
}

// errorAtHolds is the "decided position" rule for a syntax case. A problem node (ERROR or MISSING) holds the byte offset
// at when it starts at or before at and either contains it (end >= at) or ends before it with only gap characters
// (whitespace) in between: recovery often leaves the ERROR or MISSING node on the last good token while tsc names the
// next token.
func errorAtHolds(nodes []node, src []byte, at int) bool {
	for _, n := range nodes {
		if (n.err || n.missing) && n.start <= at && (at <= n.end || onlyGap(src[n.end:at])) {
			return true
		}
	}
	return false
}

func onlyGap(b []byte) bool {
	for len(b) > 0 {
		r, size := utf8.DecodeRune(b)
		if r == utf8.RuneError && size <= 1 || !isGap(r) {
			return false
		}
		b = b[size:]
	}
	return true
}

// check compares one tree with the verdict (accept or syntax). It returns the differences, empty when the case is
// consistent.
func check(c Case, verdict string, nodes []node, r Report) []string {
	var diffs []string
	switch verdict {
	case "accept":
		switch {
		case r.HasError():
			diffs = append(diffs, "accepted by tsc but the tree has an error: "+r.String())
		case !r.Clean():
			diffs = append(diffs, "accepted by tsc but the tree is not faithful: "+r.String())
		}
		for _, e := range c.Expect {
			s, en, kind, _ := parseExpect(e)
			if got := deepest(nodes, s, en); got != kind {
				diffs = append(diffs, fmt.Sprintf("expect %s: deepest node is %q", e, got))
			}
		}
	case "syntax":
		switch {
		case !r.HasError():
			diffs = append(diffs, "rejected by tsc as syntax but the tree is "+r.String())
		case !errorAtHolds(nodes, []byte(c.Source), *c.ErrorAt):
			diffs = append(diffs, fmt.Sprintf("no ERROR or MISSING node holds byte %d (first problem: %s)", *c.ErrorAt, r.First))
		}
	}
	return diffs
}
