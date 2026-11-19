#include "tree_sitter/parser.h"

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
    LEXICAL_DECLARATION_BINDING,
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

// After `in(`: a method or method signature named `in` when the balanced parameter list is followed by a body, a
// return type or the end of the member. In a for-in header, `in (y)` is followed by `)` or an operator instead.
// shortcut: a parenthesis inside a string, template or regex in the list is counted; upgrade if one shows up there.
static bool parameters_end_member(TSLexer *lexer) {
    for (unsigned depth = 0;;) {
        int32_t c = lexer->lookahead;
        if (c == 0) {
            return false;
        }
        skip(lexer);
        if (c == '(') {
            depth++;
        } else if (c == ')' && --depth == 0) {
            break;
        }
    }
    if (!skip_space_and_comments(lexer)) {
        return false;
    }
    switch (lexer->lookahead) {
        case 0:
        case '{':
        case ':':
        case ';':
        case '}':
            return true;
        default:
            return false;
    }
}

// After a line break, `in` or `instanceof` names the next class or type member (as in tsc) when no binary operator may
// follow and the next character can only follow a member name; `for (var x⏎in y)` keeps its `in`. Code points
// only, so the result does not depend on the C library.
static bool keyword_starts_member(TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[LOGICAL_OR]) {
        return false;
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
        case '(':
            return parameters_end_member(lexer);
        default:
            return false;
    }
}

// After `let`, a next-line word that goes on past `in` or `instanceof` with other than an ASCII letter (`let⏎in_x = 1`,
// `let⏎instanceof_x`) continues the declaration, as in tsc and as before this change (the old iswalpha() check sent it
// to keyword_starts_member, which inserts no semicolon where `||` may follow).
// shortcut: other next-line words after `let` (`let⏎x = 1`, `let⏎inx = 1`) still get a semicolon, as before; upgrade
// with a reserved-word check if tsc's reading of those is wanted.
static bool word_continues_let(int32_t c, const bool *valid_symbols) {
    return valid_symbols[LEXICAL_DECLARATION_BINDING] && !valid_symbols[ERROR_RECOVERY] &&
           !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
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
            while (is_space(lexer->lookahead)) {
                skip(lexer);
            }
            return lexer->lookahead != '{';

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

            if (!is_identifier_part(lexer->lookahead)) {
                return keyword_starts_member(lexer, valid_symbols);
            }
            if (word_continues_let(lexer->lookahead, valid_symbols)) {
                return false;
            }

            for (unsigned i = 0; i < 8; i++) {
                if (lexer->lookahead != "stanceof"[i]) {
                    return true;
                }
                skip(lexer);
            }

            if (!is_identifier_part(lexer->lookahead)) {
                return keyword_starts_member(lexer, valid_symbols);
            }
            return !word_continues_let(lexer->lookahead, valid_symbols);
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
