#include "tree_sitter/parser.h"

#include <string.h>
#include <wctype.h>

enum TokenType {
    AUTOMATIC_SEMICOLON,
    TEMPLATE_CHARS,
    TERNARY_QMARK,
    HTML_COMMENT,
    LOGICAL_OR,
    ESCAPE_SEQUENCE,
    REGEX_PATTERN,
    JSX_TEXT,
    FUNCTION_SIGNATURE_AUTOMATIC_SEMICOLON,
    ERROR_RECOVERY,
};

static void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static bool scan_template_chars(TSLexer *lexer) {
    lexer->result_symbol = TEMPLATE_CHARS;
    for (bool has_content = false;; has_content = true) {
        lexer->mark_end(lexer);
        switch (lexer->lookahead) {
            case '`':
                return has_content;
            case '\0':
                return false;
            case '$':
                advance(lexer);
                if (lexer->lookahead == '{') {
                    return has_content;
                }
                break;
            case '\\':
                return has_content;
            default:
                advance(lexer);
        }
    }
}

// ECMAScript LineTerminator by code point: iswspace() of U+2028/U+2029 depends on the C library and locale.
static bool is_line_terminator(int32_t c) { return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029; }

// Skips a block comment after its `/*`; true when it is closed. Sets *line_break when it holds a line terminator.
static bool skip_block_comment(TSLexer *lexer, bool *line_break) {
    while (lexer->lookahead != 0) {
        if (lexer->lookahead == '*') {
            skip(lexer);
            if (lexer->lookahead == '/') {
                skip(lexer);
                return true;
            }
        } else {
            *line_break |= is_line_terminator(lexer->lookahead);
            skip(lexer);
        }
    }
    return false;
}

static bool scan_whitespace_and_comments(TSLexer *lexer, bool *scanned_comment) {
    for (;;) {
        while (iswspace(lexer->lookahead) || is_line_terminator(lexer->lookahead)) {
            skip(lexer);
        }

        if (lexer->lookahead == '/') {
            skip(lexer);

            if (lexer->lookahead == '/') {
                skip(lexer);
                while (lexer->lookahead != 0 && !is_line_terminator(lexer->lookahead)) {
                    skip(lexer);
                }
                *scanned_comment = true;
            } else if (lexer->lookahead == '*') {
                skip(lexer);
                bool line_break = false;
                // As tree-sitter-javascript e7d9759: else the ternary `?` fallback swallows this comment.
                *scanned_comment |= skip_block_comment(lexer, &line_break);
            } else {
                return false;
            }
        } else {
            return true;
        }
    }
}

// The grammar's extras by code point (iswspace() depends on the C library and locale): ASCII white space and
// /[\s\p{Zs}\uFEFF\u2028\u2029\u2060\u200B]/. U+0085 is not in it: the grammar lexes it as an identifier character.
static bool is_space(int32_t c) {
    return c == ' ' || (c >= '\t' && c <= '\r') || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200B) ||
           c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x2060 || c == 0x3000 || c == 0xFEFF;
}

// Whether `c` continues a word, by code point. ASCII as tsc: letters, digits, `_`, `$`, and `\` of a `\u` escape.
// Other code points as the grammar's identifier token: all but white space.
static bool is_identifier_part(int32_t c) {
    if (c < 0x80) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$' ||
               c == '\\';
    }
    return !is_space(c);
}

// Skips white space, line terminators and comments; false at a `/` that starts neither comment.
static bool skip_space_and_comments(TSLexer *lexer) {
    for (;;) {
        while (is_space(lexer->lookahead)) {
            skip(lexer);
        }
        if (lexer->lookahead != '/') {
            return true;
        }
        skip(lexer);
        if (lexer->lookahead == '/') {
            while (lexer->lookahead != 0 && !is_line_terminator(lexer->lookahead)) {
                skip(lexer);
            }
        } else if (lexer->lookahead == '*') {
            skip(lexer);
            bool line_break = false;
            if (!skip_block_comment(lexer, &line_break)) {
                return false;
            }
        } else {
            return false;
        }
    }
}

// What follows the end of a bracketed list, decided one character at a time so that two counts of the end can run over
// the same characters: the first non-space, non-comment character after it must be in `follow`.
typedef enum { LIST_COUNT, LIST_SPACE, LIST_SLASH, LIST_LINE_COMMENT, LIST_BLOCK_COMMENT, LIST_DONE } ListMode;

typedef struct {
    int32_t open, close;
    const char *follow;
    bool eof_follows; // the answer when the input ends where `follow` is checked
    ListMode mode;
    unsigned depth;
    bool star; // the last character of a block comment was `*`
    bool answer;
} ListEnd;

// Feeds one character (0 at the end of input). `code` is false for a character that a literal-aware count leaves out.
static void list_end_feed(ListEnd *e, int32_t c, bool code) {
    switch (e->mode) {
        case LIST_COUNT:
            if (c == 0) {
                e->mode = LIST_DONE;
                e->answer = false;
            } else if (code && c == e->open) {
                e->depth++;
            } else if (code && c == e->close && --e->depth == 0) {
                e->mode = LIST_SPACE;
            }
            return;
        case LIST_SPACE:
            if (c == '/') {
                e->mode = LIST_SLASH;
            } else if (!is_space(c)) {
                e->mode = LIST_DONE;
                e->answer = c == 0 ? e->eof_follows : c < 0x80 && strchr(e->follow, c) != NULL;
            }
            return;
        case LIST_SLASH:
            e->star = false;
            e->mode = c == '/' ? LIST_LINE_COMMENT : c == '*' ? LIST_BLOCK_COMMENT : LIST_DONE;
            e->answer = false;
            return;
        case LIST_LINE_COMMENT:
            if (c == 0) {
                e->mode = LIST_DONE;
                e->answer = e->eof_follows;
            } else if (is_line_terminator(c)) {
                e->mode = LIST_SPACE;
            }
            return;
        case LIST_BLOCK_COMMENT:
            if (c == 0) {
                e->mode = LIST_DONE;
                e->answer = false;
            } else {
                if (e->star && c == '/') {
                    e->mode = LIST_SPACE;
                }
                e->star = c == '*';
            }
            return;
        case LIST_DONE:
            return;
    }
}

// Which literal or comment the characters of a list are in, for a lexer that stops at what it cannot tell.
typedef enum {
    LEX_CODE,
    LEX_STRING,
    LEX_TEMPLATE,
    LEX_REGEX,
    LEX_REGEX_CLASS,
    LEX_LINE_COMMENT,
    LEX_BLOCK_COMMENT,
    LEX_SLASH
} LexMode;

typedef struct {
    LexMode mode;
    int32_t quote;
    int32_t prev; // the last code character; `"` after a literal, `a` after a word or any other code point above ASCII
    int32_t last; // the last character inside a template or a block comment
    bool escaped;
} Lex;

// After `prev`, a `/` starts a regular expression (1), is a division (0), or is unclear (-1): after `)`, `}`, `>`, `+`,
// `-`, `!`, `.` or a word it depends on what came before (`if (x) /re/`, `x++ / y`, `return /re/`).
static int slash_role(int32_t prev) {
    if (prev == 0 || strchr("(,=:[&|?{;*%<~^/", prev) != NULL) {
        return 1;
    }
    return prev == ']' || prev == '"' ? 0 : -1;
}

// Feeds one character of the list. Returns false when it cannot be told whether it is code: an unterminated literal, a
// line continuation or a line terminator in a string or regular expression, a `${`, a `/` of unclear role, the end of
// the input. Sets *code when the character is code, the only kind a bracket count may use.
static bool lex_feed(Lex *x, int32_t c, bool *code) {
    *code = x->mode == LEX_CODE && !(c == '>' && x->prev == '='); // `=>` is not a `>`
    if (c == 0) {
        return false;
    }
    if (x->escaped) {
        x->escaped = false;
        x->last = 0;
        return x->mode == LEX_TEMPLATE || !is_line_terminator(c);
    }
    switch (x->mode) {
        case LEX_CODE:
            if (c == '"' || c == '\'') {
                x->mode = LEX_STRING;
                x->quote = c;
            } else if (c == '`') {
                x->mode = LEX_TEMPLATE;
                x->last = 0;
            } else if (c == '/') {
                x->mode = LEX_SLASH;
            } else if (!is_space(c)) {
                x->prev = c < 0x80 ? c : 'a';
            }
            return true;
        case LEX_SLASH:
            if (c == '/' || c == '*') {
                x->mode = c == '/' ? LEX_LINE_COMMENT : LEX_BLOCK_COMMENT;
                x->last = 0;
                return true;
            }
            switch (slash_role(x->prev)) {
                case 1:
                    x->mode = LEX_REGEX;
                    break;
                case 0:
                    x->mode = LEX_CODE;
                    x->prev = '/';
                    break;
                default:
                    return false;
            }
            return lex_feed(x, c, code);
        case LEX_STRING:
        case LEX_REGEX:
        case LEX_REGEX_CLASS:
            if (is_line_terminator(c)) {
                return false;
            }
            if (c == '\\') {
                x->escaped = true;
            } else if (x->mode == LEX_STRING ? c == x->quote : (c == '/' && x->mode == LEX_REGEX)) {
                x->mode = LEX_CODE;
                x->prev = '"';
            } else if (x->mode != LEX_STRING && (c == '[' || c == ']')) {
                x->mode = c == '[' ? LEX_REGEX_CLASS : LEX_REGEX;
            }
            return true;
        case LEX_TEMPLATE:
            if (c == '{' && x->last == '$') {
                return false;
            }
            if (c == '\\') {
                x->escaped = true;
            } else if (c == '`') {
                x->mode = LEX_CODE;
                x->prev = '"';
            }
            x->last = c;
            return true;
        case LEX_LINE_COMMENT:
            if (is_line_terminator(c)) {
                x->mode = LEX_CODE;
            }
            return true;
        case LEX_BLOCK_COMMENT:
            if (x->last == '*' && c == '/') {
                x->mode = LEX_CODE;
            }
            x->last = c;
            return true;
    }
    return false;
}

// Whether the list that starts at the lookahead (`open`) ends with `close` and is followed by a character of `follow`.
// Brackets inside a string, template, regular expression or comment are not counted. Whatever the lexer cannot tell
// (see lex_feed) ends its count; then the answer is that of counting every `open` and `close` character, as before
// literals were skipped (`naive_fallback`), or false. So literal skipping only adds right answers, it never takes one
// away. The lexer stops at the deciding character without consuming it.
static bool list_followed_by(TSLexer *lexer, int32_t open, int32_t close, const char *follow, bool eof_follows,
                             bool naive_fallback) {
    ListEnd exact = {open, close, follow, eof_follows, LIST_COUNT, 0, false, false};
    ListEnd naive = exact;
    Lex lex = {LEX_CODE, 0, 0, 0, false};
    bool sure = true;
    for (;;) {
        int32_t c = lexer->lookahead;
        bool code = true;
        if (sure && exact.mode == LIST_COUNT && !lex_feed(&lex, c, &code)) {
            sure = false;
        }
        if (!sure && !naive_fallback) {
            return false;
        }
        if (sure) {
            list_end_feed(&exact, c, code);
            if (exact.mode == LIST_DONE) {
                return exact.answer;
            }
        }
        if (naive_fallback) {
            list_end_feed(&naive, c, true);
            if (!sure && naive.mode == LIST_DONE) {
                return naive.answer;
            }
        }
        skip(lexer);
    }
}

// After `in(`: a method or method signature named `in` when the parameter list is followed by a body, a return type or
// the end of the member. In a for-in header, `in (y)` is followed by `)` or an operator instead.
static bool parameters_end_member(TSLexer *lexer) { return list_followed_by(lexer, '(', ')', "{:;}", true, true); }

// After a line break, `in` or `instanceof` names the next class or type member (as in tsc) when no binary operator may
// follow and the next character can only follow a member name; `for (var x⏎in y)` keeps its `in`. A word that goes on
// (`in1`, `in_`, `in$`) is a member name too. Code points only, so the result does not depend on the C library.
static bool keyword_starts_member(TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[LOGICAL_OR]) {
        return false;
    }
    if (is_identifier_part(lexer->lookahead)) {
        return true;
    }
    for (;;) {
        while (is_space(lexer->lookahead) && !is_line_terminator(lexer->lookahead)) {
            skip(lexer);
        }
        if (lexer->lookahead != '/') {
            break;
        }
        // A block comment on the same line, `in /* x */ = 1`; anything else keeps the old answer.
        skip(lexer);
        if (lexer->lookahead != '*') {
            return false;
        }
        skip(lexer);
        bool line_break = false;
        if (!skip_block_comment(lexer, &line_break) || line_break) {
            return false;
        }
    }
    switch (lexer->lookahead) {
        case 0:
        case '=':
        case ':':
        case '?':
        case ';':
        case '}':
            return true;
        case '<': // `in<T>() {}`: `in <T>(y)` in a for-in header is followed by `)` instead
            return list_followed_by(lexer, '<', '>', "(", false, false) && parameters_end_member(lexer);
        case '(':
            return parameters_end_member(lexer);
        default:
            return false;
    }
}

// Automatic semicolon insertion breaks detection of object patterns
// in a typed context:
//   type F = ({a}: {a: number}) => number;
// Therefore, disable automatic semicolons when followed by typing
static bool scan_closing_brace(TSLexer *lexer, const bool *valid_symbols) {
    do {
        skip(lexer);
    } while (is_space(lexer->lookahead));
    if (lexer->lookahead == ':') {
        return valid_symbols[LOGICAL_OR]; // Don't return false if we're in a ternary by checking if || is valid
    }
    return true;
}

static bool scan_automatic_semicolon(TSLexer *lexer, const bool *valid_symbols, bool *scanned_comment) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    // A block comment holding a line terminator counts as one, as in tsc. After any comment, a later line
    // terminator, `}` or end of input is left to the next call, made once the lexer has read the comment, as before.
    // So that no call rescans a run of comments, a comment without a line terminator before any line terminator is
    // left to the lexer (as before), and so is a second comment holding one: the next call starts at it.
    bool comment = false;
    bool comment_line_break = false;
    for (;;) {
        if (lexer->lookahead == 0) {
            return !comment;
        }
        if (lexer->lookahead == '}') {
            if (comment) {
                return false;
            }
            return scan_closing_brace(lexer, valid_symbols);
        }
        if (lexer->lookahead == '/') {
            skip(lexer);
            if (lexer->lookahead != '*') {
                return false;
            }
            skip(lexer);
            *scanned_comment = true;
            bool line_break = false;
            if (!skip_block_comment(lexer, &line_break) || line_break == comment_line_break) {
                return false;
            }
            comment = true;
            comment_line_break = true;
            continue;
        }
        if (is_line_terminator(lexer->lookahead)) {
            if (comment) {
                return false;
            }
            skip(lexer);
            break;
        }
        if (!iswspace(lexer->lookahead)) {
            if (comment_line_break) {
                break;
            }
            return false;
        }
        skip(lexer);
    }

    if (!scan_whitespace_and_comments(lexer, scanned_comment)) {
        return false;
    }

    switch (lexer->lookahead) {
        case '}':
            return scan_closing_brace(lexer, valid_symbols);

            // Import attributes may follow a line break (as in tsc); a `with` statement always has `(`.
        case 'w':
            skip(lexer);
            for (const char *rest = "ith"; *rest != 0; rest++) {
                if (lexer->lookahead != *rest) {
                    return true;
                }
                skip(lexer);
            }
            if (is_identifier_part(lexer->lookahead)) {
                return true;
            }
            return !skip_space_and_comments(lexer) || lexer->lookahead != '{';

        case '`':
        case ',':
        case '.':
        case ';':
        case '*':
        case '%':
        case '>':
        case '<':
        case '=':
        case '?':
        case '^':
        case '|':
        case '&':
        case '/':
        case ':':
            return false;

        case '{':
            if (valid_symbols[FUNCTION_SIGNATURE_AUTOMATIC_SEMICOLON]) {
                return false;
            }
            break;

            // Don't insert a semicolon before a '[' or '(', unless we're parsing
            // a type. Detect whether we're parsing a type or an expression using
            // the validity of a binary operator token.
        case '(':
        case '[':
            if (valid_symbols[LOGICAL_OR]) {
                return false;
            }
            break;

            // Insert a semicolon before `--` and `++`, but not before binary `+` or `-`.
        case '+':
            skip(lexer);
            return lexer->lookahead == '+';
        case '-':
            skip(lexer);
            return lexer->lookahead == '-';

            // Don't insert a semicolon before `!=`, but do insert one before a unary `!`.
        case '!':
            skip(lexer);
            return lexer->lookahead != '=';

            // Don't insert a semicolon before `in` or `instanceof`, but do insert one
            // before an identifier.
        case 'i':
            skip(lexer);

            if (lexer->lookahead != 'n') {
                return true;
            }
            skip(lexer);

            if (!iswalpha(lexer->lookahead)) {
                return keyword_starts_member(lexer, valid_symbols);
            }

            for (unsigned i = 0; i < 8; i++) {
                if (lexer->lookahead != "stanceof"[i]) {
                    return true;
                }
                skip(lexer);
            }

            if (!iswalpha(lexer->lookahead)) {
                return keyword_starts_member(lexer, valid_symbols);
            }
            break;
    }

    return true;
}

static bool scan_ternary_qmark(TSLexer *lexer) {
    for (;;) {
        if (!iswspace(lexer->lookahead)) {
            break;
        }
        skip(lexer);
    }

    if (lexer->lookahead == '?') {
        advance(lexer);

        /* Optional chaining. */
        if (lexer->lookahead == '?' || lexer->lookahead == '.') {
            return false;
        }

        lexer->mark_end(lexer);
        lexer->result_symbol = TERNARY_QMARK;

        /* TypeScript optional arguments contain the ?: sequence, possibly
           with whitespace. */
        for (;;) {
            if (!iswspace(lexer->lookahead)) {
                break;
            }
            advance(lexer);
        }

        if (lexer->lookahead == ':' || lexer->lookahead == ')' || lexer->lookahead == ',') {
            return false;
        }

        if (lexer->lookahead == '.') {
            advance(lexer);
            if (iswdigit(lexer->lookahead)) {
                return true;
            }
            return false;
        }
        return true;
    }
    return false;
}

static bool scan_closing_comment(TSLexer *lexer) {
    while (iswspace(lexer->lookahead) || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
        skip(lexer);
    }

    const char *comment_start = "<!--";
    const char *comment_end = "-->";

    if (lexer->lookahead == '<') {
        for (unsigned i = 0; i < 4; i++) {
            if (lexer->lookahead != comment_start[i]) {
                return false;
            }
            advance(lexer);
        }
    } else if (lexer->lookahead == '-') {
        for (unsigned i = 0; i < 3; i++) {
            if (lexer->lookahead != comment_end[i]) {
                return false;
            }
            advance(lexer);
        }
    } else {
        return false;
    }

    while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != 0x2028 &&
           lexer->lookahead != 0x2029) {
        advance(lexer);
    }

    lexer->result_symbol = HTML_COMMENT;
    lexer->mark_end(lexer);

    return true;
}

// After an `&`: is what follows the rest of an HTML character reference
// (`&amp;`, `&#38;`, `&#x26;`), as the grammar's html_character_reference
// token defines it? Consumes the name or number either way.
static bool scan_character_reference_tail(TSLexer *lexer) {
    unsigned length = 0;
    if (lexer->lookahead == '#') {
        advance(lexer);
        if (lexer->lookahead == 'x' || lexer->lookahead == 'X') {
            advance(lexer);
            // ASCII as in html_character_reference; isw*digit vary by platform (ours, on top of upstream #371).
            while (length < 6 && ((lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
                                  (lexer->lookahead >= 'a' && lexer->lookahead <= 'f') ||
                                  (lexer->lookahead >= 'A' && lexer->lookahead <= 'F'))) {
                advance(lexer);
                length++;
            }
        } else {
            while (length < 5 && lexer->lookahead >= '0' && lexer->lookahead <= '9') {
                advance(lexer);
                length++;
            }
        }
    } else {
        while (length < 30 && ((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
                               (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z'))) {
            advance(lexer);
            length++;
        }
    }
    return length > 0 && lexer->lookahead == ';';
}

static bool scan_jsx_text(TSLexer *lexer) {
    // saw_text will be true if we see any non-whitespace content, or any whitespace content that is not a newline and
    // does not immediately follow a newline.
    bool saw_text = false;
    // at_newline will be true if we are currently at a newline, or if we are at whitespace that is not a newline but
    // immediately follows a newline.
    bool at_newline = false;

    lexer->result_symbol = JSX_TEXT;

    while (lexer->lookahead != 0 && lexer->lookahead != '<' && lexer->lookahead != '>' && lexer->lookahead != '{' &&
           lexer->lookahead != '}') {
        if (lexer->lookahead == '&') {
            // A character reference is its own token: the text ends before it.
            // A bare ampersand (`Shipping & Handling`) is text.
            lexer->mark_end(lexer);
            advance(lexer);
            if (scan_character_reference_tail(lexer)) {
                return saw_text;
            }
            saw_text = true;
            at_newline = false;
            continue;
        }
        bool is_wspace = iswspace(lexer->lookahead);
        if (lexer->lookahead == '\n') {
            at_newline = true;
        } else {
            // If at_newline is already true, and we see some whitespace, then it must stay true.
            // Otherwise, it should be false.
            //
            // See the table below to determine the logic for computing `saw_text`.
            //
            // |------------------------------------|
            // | at_newline | is_wspace | saw_text  |
            // |------------|-----------|-----------|
            // | false (0)  | false (0) | true  (1) |
            // | false (0)  | true  (1) | true  (1) |
            // | true  (1)  | false (0) | true  (1) |
            // | true  (1)  | true  (1) | false (0) |
            // |------------------------------------|

            at_newline &= is_wspace;
            if (!at_newline) {
                saw_text = true;
            }
        }

        advance(lexer);
    }

    lexer->mark_end(lexer);
    return saw_text;
}

static inline bool external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[TEMPLATE_CHARS]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        return scan_template_chars(lexer);
    }

    if (valid_symbols[JSX_TEXT] && scan_jsx_text(lexer)) {
        return true;
    }

    if (valid_symbols[AUTOMATIC_SEMICOLON] || valid_symbols[FUNCTION_SIGNATURE_AUTOMATIC_SEMICOLON]) {
        bool scanned_comment = false;
        bool ret = scan_automatic_semicolon(lexer, valid_symbols, &scanned_comment);
        if (!ret && !scanned_comment && valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        return ret;
    }
    if (valid_symbols[TERNARY_QMARK]) {
        return scan_ternary_qmark(lexer);
    }

    if (valid_symbols[HTML_COMMENT] && !valid_symbols[LOGICAL_OR] && !valid_symbols[ESCAPE_SEQUENCE] &&
        !valid_symbols[REGEX_PATTERN]) {
        return scan_closing_comment(lexer);
    }

    return false;
}
