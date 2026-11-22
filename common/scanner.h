#include "tree_sitter/parser.h"

#include <stdlib.h>
#include <string.h>

enum TokenType {
    AUTOMATIC_SEMICOLON,
    TEMPLATE_CHARS,
    TERNARY_QMARK,
    HTML_COMMENT,
    LOGICAL_OR,
    ESCAPE_SEQUENCE,
    REGEX_PATTERN,
    JSX_TEXT,
    BINDING_END, // Never returned: only its validity is read (see grammar.js).
    KEYWORD_CONTINUES,
    RESTRICTED_KEYWORD, // Never returned: only its validity is read (see grammar.js).
    DECLARATION_END,
    GENERATOR_METHOD_CONTINUES,
    STATIC_BEFORE_GET_FIELD,
    AWAIT_OPERAND_CONTINUES,
    CONTEXT_IDENTIFIER,
    ENTER_PLAIN,
    ENTER_AWAIT,
    ENTER_YIELD,
    ENTER_BOTH,
    ENTER_PLAIN_EXPRESSION,
    ENTER_ASYNC_ARROW,
    ENTER_STATIC_BLOCK,
    LEAVE_CONTEXT,
    LEAVE_CONCISE_BODY,
    YIELD_OPERAND,
    YIELD_LINE_TERMINATOR,
    ANNEX_PREFIX,
    AWAIT_USING,
    JSX_ATTRIBUTE_CHARACTER_REFERENCE,
    JSX_DOUBLE_STRING_FRAGMENT,
    JSX_SINGLE_STRING_FRAGMENT,
    ARROW_FUNCTION_END,
    POSTFIX_UPDATE_END,
    AWAIT_USING_ASI,
    CONTEXT_AWAIT,
    FUNCTION_SIGNATURE_AUTOMATIC_SEMICOLON,
    ERROR_RECOVERY,
    COMPARISON_GT,
    LEAVE_SIGNATURE,
    LEXICAL_DECLARATION_BINDING, // Never emitted. Valid after let or const.
};

enum Context {
    AWAIT_CONTEXT = 1,
    YIELD_CONTEXT = 2,
    ASYNC_ARROW_CONTEXT = 4,
};

// Keep the two-bit await/yield stack ahead of the async-arrow bitmap.
// shortcut: excess scopes use the base lexer until they close; use parser states if deeper nesting needs full context.
enum {
    SCOPE_HEADER_SIZE = 6,
    // Scope depths fit below the serialized flags.
    ASI_PENDING = 0x4000,
    DECLARATION_PENDING = 0x1000,
    SCOPE_BYTES = TREE_SITTER_SERIALIZATION_BUFFER_SIZE - SCOPE_HEADER_SIZE,
};

typedef struct {
    uint32_t overflow;
    uint16_t depth;
    uint16_t pending_token;
    uint8_t flags[SCOPE_BYTES];
    uint8_t async_arrows[(SCOPE_BYTES + 1) / 2];
} Scanner;

static void *scope_create(void) { return calloc(1, sizeof(Scanner)); }

static void scope_destroy(void *payload) { free(payload); }

static unsigned scope_serialize(void *payload, char *buffer) {
    const Scanner *scanner = payload;
    if (!scanner->depth && !scanner->pending_token) return 0;

    unsigned length = (scanner->depth + 3) / 4;
    memcpy(buffer, &scanner->overflow, sizeof(scanner->overflow));
    uint16_t state = scanner->depth | scanner->pending_token;
    memcpy(buffer + sizeof(scanner->overflow), &state, sizeof(state));
    memcpy(buffer + SCOPE_HEADER_SIZE, scanner->flags, length);
    unsigned used_bits = (scanner->depth % 4) * 2;
    if (used_bits) buffer[SCOPE_HEADER_SIZE + length - 1] &= (1u << used_bits) - 1;

    // shortcut: if the bitmap does not fit, keep the await/yield flags; revisit for deeply nested async arrows.
    unsigned arrow_length = (scanner->depth + 7) / 8;
    unsigned available = SCOPE_BYTES - length;
    unsigned copied = arrow_length < available ? arrow_length : available;
    char *arrows = buffer + SCOPE_HEADER_SIZE + length;
    memcpy(arrows, scanner->async_arrows, copied);
    used_bits = scanner->depth % 8;
    if (used_bits && copied == arrow_length) arrows[copied - 1] &= (1u << used_bits) - 1;
    while (copied && !arrows[copied - 1]) copied--;
    return SCOPE_HEADER_SIZE + length + copied;
}

static void scope_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = payload;
    if (length < SCOPE_HEADER_SIZE || length > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) goto empty;

    uint16_t state;
    memcpy(&state, buffer + sizeof(scanner->overflow), sizeof(state));
    uint16_t depth = state & ~(ASI_PENDING | DECLARATION_PENDING);
    scanner->pending_token = state & (ASI_PENDING | DECLARATION_PENDING);
    if (length == SCOPE_HEADER_SIZE + 1 && depth >= 1 && depth <= 4) {
        scanner->depth = depth;
        memcpy(&scanner->overflow, buffer, sizeof(scanner->overflow));
        scanner->flags[0] = (uint8_t)buffer[SCOPE_HEADER_SIZE];
        scanner->async_arrows[0] = 0;
        return;
    }
    unsigned flag_length = (depth + 3u) / 4;
    if (depth > SCOPE_BYTES * 4 || length < SCOPE_HEADER_SIZE + flag_length) goto empty;
    unsigned arrow_length = (depth + 7u) / 8;
    unsigned copied = length - SCOPE_HEADER_SIZE - flag_length;
    if (copied > arrow_length) goto empty;

    scanner->depth = depth;
    memcpy(&scanner->overflow, buffer, sizeof(scanner->overflow));
    memcpy(scanner->flags, buffer + SCOPE_HEADER_SIZE, flag_length);
    memcpy(scanner->async_arrows, buffer + SCOPE_HEADER_SIZE + flag_length, copied);
    memset(scanner->async_arrows + copied, 0, arrow_length - copied);
    return;

empty:
    scanner->depth = 0;
    scanner->pending_token = 0;
    scanner->overflow = 0;
}

static void enter_context(Scanner *scanner, unsigned flags) {
    if (scanner->depth == SCOPE_BYTES * 4) {
        scanner->overflow++;
        return;
    }
    unsigned index = scanner->depth++;
    unsigned shift = (index % 4) * 2;
    scanner->flags[index / 4] = (scanner->flags[index / 4] & ~(3u << shift)) | ((flags & 3u) << shift);
    unsigned bit = 1u << (index % 8);
    scanner->async_arrows[index / 8] = (scanner->async_arrows[index / 8] & ~bit) |
                                      ((flags & ASYNC_ARROW_CONTEXT) ? bit : 0);
}

static unsigned context_flags(const Scanner *scanner) {
    if (scanner->overflow) return AWAIT_CONTEXT | YIELD_CONTEXT;
    if (!scanner->depth) return AWAIT_CONTEXT;
    unsigned index = scanner->depth - 1;
    unsigned flags = (scanner->flags[index / 4] >> ((index % 4) * 2)) & 3u;
    if (scanner->async_arrows[index / 8] & (1u << (index % 8))) flags |= ASYNC_ARROW_CONTEXT;
    return flags;
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static bool scan_template_chars(TSLexer *lexer) {
    lexer->result_symbol = TEMPLATE_CHARS;
    for (bool has_content = false;; has_content = true) {
        lexer->mark_end(lexer);
        // The end of the input, not a U+0000 in the template (both have lookahead 0).
        if (lexer->eof(lexer)) {
            return false;
        }
        switch (lexer->lookahead) {
            case '`':
            case '\\':
                return has_content;
            case '$':
                advance(lexer);
                if (lexer->lookahead == '{') {
                    return has_content;
                }
                break;
            default:
                advance(lexer);
        }
    }
}

// White space and line terminators as the grammar's `extras` regex has them (extras_character_set_1 in parser.c).
// Explicit, not iswspace: that differs between C runtimes (C locale, glibc, Windows UCRT).
static bool is_extra_space(int32_t c) {
    if ((uint32_t)c < 0x80) return (c >= '\t' && c <= '\r') || c == ' ';
    return c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200b) ||
           c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x2060 || c == 0x3000 || c == 0xfeff;
}

// Blank in a JSX text line: ASCII white space only (the C locale's iswspace). Any other character is text, as in Babel,
// which trims only spaces and tabs: U+00A0, U+3000, U+200B, U+FEFF and the others are content, not layout.
static bool is_jsx_space(int32_t c) { return (c >= '\t' && c <= '\r') || c == ' '; }

// ASCII, not iswdigit: that matches non-ASCII digits on some C runtimes.
static bool is_digit(int32_t c) { return c >= '0' && c <= '9'; }

typedef enum {
    ASI_NEXT_TOKEN,
    ASI_SLASH,
    ASI_END,
} ASILookahead;

typedef struct {
    bool newline;
    bool comment;
    bool leading_non_cr_break;
    bool break_after_comment;
    bool non_cr_break_after_comment;
    bool can_defer_binding;
    bool line_comment;
    bool ends_at_block_comment;
} ASITrivia;

static bool is_line_terminator(int32_t c) {
    return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029;
}

typedef enum {
    RANGE_IGNORE,
    RANGE_BETWEEN_TOKENS,
    RANGE_STOP,
} RangePolicy;

static bool at_range_start(TSLexer *lexer, bool stop_at_range) {
    return stop_at_range && lexer->is_at_included_range_start(lexer);
}

// The runtime sets lookahead to 0 at EOF, so the trivia loops call eof() only for a 0 lookahead.
static void scan_line_comment_body(TSLexer *lexer, bool stop_at_range, bool skip_body) {
    for (;;) {
        int32_t c = lexer->lookahead;
        if ((c == 0 && lexer->eof(lexer)) || at_range_start(lexer, stop_at_range) || is_line_terminator(c)) return;
        lexer->advance(lexer, skip_body);
    }
}

// A line terminator inside a block comment counts as a line terminator between tokens (ECMA-262 12.4).
static ASILookahead scan_asi_trivia(TSLexer *lexer, ASITrivia *trivia, bool preserve_start, RangePolicy range) {
    bool stop_at_range = range == RANGE_STOP;
    for (;;) {
        int32_t c = lexer->lookahead;
        if ((c == 0 && lexer->eof(lexer)) || at_range_start(lexer, range != RANGE_IGNORE)) {
            return ASI_END;
        }
        if (is_extra_space(c)) {
            trivia->ends_at_block_comment = false;
            if (is_line_terminator(c)) {
                trivia->newline = true;
                trivia->break_after_comment |= trivia->comment;
                // Keep the old comment attachment where CR counted only for declaration termination.
                trivia->leading_non_cr_break |= !trivia->comment && c != '\r';
                trivia->non_cr_break_after_comment |= trivia->comment && c != '\r';
            }
            lexer->advance(lexer, !preserve_start);
        } else if (c != '/') {
            return ASI_NEXT_TOKEN;
        } else {
            bool skip_block = !preserve_start;
            lexer->advance(lexer, skip_block);
            if (at_range_start(lexer, stop_at_range)) return ASI_END;
            if (lexer->lookahead == '/') {
                trivia->line_comment = true;
                lexer->advance(lexer, !preserve_start);
                scan_line_comment_body(lexer, stop_at_range, !preserve_start);
            } else if (lexer->lookahead == '*') {
                lexer->advance(lexer, skip_block);
                bool block_newline = false;
                while ((c = lexer->lookahead) != 0 || !lexer->eof(lexer)) {
                    if (at_range_start(lexer, stop_at_range)) return ASI_END;
                    lexer->advance(lexer, skip_block);
                    if (at_range_start(lexer, stop_at_range)) return ASI_END;
                    if (c == '*' && lexer->lookahead == '/') {
                        lexer->advance(lexer, skip_block);
                        break;
                    }
                    if (is_line_terminator(c)) {
                        block_newline = true;
                        trivia->non_cr_break_after_comment |= trivia->comment && c != '\r';
                    }
                }
                if (!trivia->comment) {
                    trivia->can_defer_binding = !block_newline && lexer->lookahead != '/';
                }
                trivia->ends_at_block_comment = true;
                trivia->newline |= block_newline;
                trivia->break_after_comment |= trivia->comment && block_newline;
            } else {
                return ASI_SLASH;
            }
            trivia->comment = true;
        }
    }
}

// The next character of an identifier name: ASCII letters and digits, `_`, `$`, `\` (an escape), and any other
// non-ASCII character that is not white space. ASCII comparisons, not isw*: those differ between C runtimes.
static bool is_comparison_space(int32_t c) {
    return c == ' ' || c == '\t' || c == '\v' || c == '\f' || c == 0x85 || c == 0xA0 || c == 0x1680 ||
           (c >= 0x2000 && c <= 0x200B) || c == 0x202F || c == 0x205F || c == 0x2060 || c == 0x3000 || c == 0xFEFF;
}

static bool scan_comparison_gt(TSLexer *lexer) {
    while (is_comparison_space(lexer->lookahead) || is_line_terminator(lexer->lookahead)) {
        skip(lexer);
    }
    if (lexer->lookahead != '>') {
        return false;
    }

    advance(lexer);
    lexer->mark_end(lexer);

    // Check the token after > without absorbing trivia into the operator.
    for (;;) {
        while (is_comparison_space(lexer->lookahead)) {
            advance(lexer);
        }
        if (lexer->lookahead != '/') {
            if (lexer->lookahead != '+' && lexer->lookahead != '-') {
                return false;
            }
            advance(lexer);
            lexer->result_symbol = COMPARISON_GT;
            return lexer->lookahead != '=';
        }
        advance(lexer);
        if (lexer->lookahead != '*') {
            return false;
        }
        advance(lexer);
        for (;;) {
            int32_t c = lexer->lookahead;
            if (lexer->eof(lexer) || is_line_terminator(c)) {
                return false;
            }
            advance(lexer);
            if (c == '*' && lexer->lookahead == '/') {
                advance(lexer);
                break;
            }
        }
    }
}

static bool is_identifier_part(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$' ||
           c == '\\' || (c > 0x7f && !is_extra_space(c));
}

static bool consume_word(TSLexer *lexer, const char *word, bool skip_word) {
    for (; *word; word++) {
        if (lexer->lookahead != *word) return false;
        lexer->advance(lexer, skip_word);
    }
    return true;
}

static bool starts_in_operator(TSLexer *lexer, bool skip_word) {
    if (!consume_word(lexer, "in", skip_word)) return false;
    return !is_identifier_part(lexer->lookahead) ||
           (consume_word(lexer, "stanceof", skip_word) && !is_identifier_part(lexer->lookahead));
}

// The words tsc --noCheck rejects as a binding after `let` and a line break (its keywords up to LastReservedWord):
// tsc reads one of these as a new statement and any other word as the binding (`let⏎x = 1`, also `let⏎yield`,
// `let⏎let`). Plus `as` and `satisfies`, kept for compatibility: tsc takes them as the binding, but the grammar
// cannot (`let as = 1;` errors on one line).
static const char *const reserved_words[] = {
    "break", "case",   "catch",  "class",      "const", "continue", "debugger", "default", "delete",
    "do",    "else",   "enum",   "export",     "extends", "false",  "finally",  "for",     "function",
    "if",    "import", "in",     "instanceof", "new",   "null",     "return",   "super",   "switch",
    "this",  "throw",  "true",   "try",        "typeof", "var",     "void",     "while",   "with",
    "as",    "satisfies",
};

// After `let` (the hidden token is valid only there) and a line break, reads the next word. A word that is not
// reserved continues the declaration; a reserved word gets the answer the switch below gives it: `in` and
// `instanceof` as at main (no semicolon), `with` as in its own case, any other one a semicolon.
static bool scan_word_after_let(TSLexer *lexer) {
    char word[11] = {0};
    bool may_be_reserved = true;
    for (unsigned n = 0; is_identifier_part(lexer->lookahead); n++, skip(lexer)) {
        if (n >= 10 || lexer->lookahead < 'a' || lexer->lookahead > 'z') {
            may_be_reserved = false;
        } else {
            word[n] = (char)lexer->lookahead;
        }
    }
    for (unsigned i = 0; may_be_reserved && i < sizeof reserved_words / sizeof reserved_words[0]; i++) {
        if (strcmp(word, reserved_words[i]) != 0) {
            continue;
        }
        if (strcmp(word, "in") == 0 || strcmp(word, "instanceof") == 0) {
            return false;
        }
        if (strcmp(word, "with") == 0) {
            while (is_extra_space(lexer->lookahead)) {
                skip(lexer);
            }
            return lexer->lookahead != '{';
        }
        return true;
    }
    return false;
}

// After a line terminator: does the token that starts at the lookahead get a semicolon inserted before it?
static bool semicolon_before_next_token(TSLexer *lexer, const bool *valid_symbols, bool declaration_end,
                                        bool defer_binding, int32_t next_char) {
    bool binding_end = valid_symbols[BINDING_END] || declaration_end;
    bool expression = valid_symbols[LOGICAL_OR];
    switch (next_char) {
        // A with-clause may follow a line break. A with-statement starts with '('.
        case 'w':
            if (!consume_word(lexer, "with", true) || is_identifier_part(lexer->lookahead)) return true;
            while (is_extra_space(lexer->lookahead)) skip(lexer);
            return lexer->lookahead != '{';
        case '{':
            return !valid_symbols[FUNCTION_SIGNATURE_AUTOMATIC_SEMICOLON] &&
                   !valid_symbols[LEXICAL_DECLARATION_BINDING];
        // A binding ends before a generator or computed member unless its prefix can still continue.
        case '*':
            return binding_end && !defer_binding && !expression &&
                   !valid_symbols[GENERATOR_METHOD_CONTINUES];
        case '[':
            return !expression && !valid_symbols[KEYWORD_CONTINUES] && (!binding_end || !defer_binding);
        case '<':
            return declaration_end && !defer_binding && !expression;

        case '(':
            // A field name can still be the name of a method. A type tail can end here.
            return !expression && !valid_symbols[BINDING_END] && (!declaration_end || !defer_binding);
        case '`':
            return declaration_end && !defer_binding;
        case ',':
        case ':':
        case ';':
        case '%':
        case '>':
        case '=':
        case '?':
        case '^':
        case '|':
        case '&':
            return false;

        // Insert a semicolon before decimals literals but not otherwise.
        case '.':
            skip(lexer);
            return is_digit(lexer->lookahead);

        // A bare declaration ends before a unary sign, an expression can continue with a binary sign.
        case '+':
        case '-':
            skip(lexer);
            return lexer->lookahead == next_char || (!expression && (!declaration_end || !defer_binding));

        // Don't insert a semicolon before `!=`, but do insert one before a unary `!`.
        case '!':
            skip(lexer);
            return lexer->lookahead != '=';

        // Don't insert a semicolon before `in` or `instanceof`, but do insert one
        // before an identifier.
        case 'i':
            return !starts_in_operator(lexer, true);

        default:
            break;
    }

    return true;
}

static bool ends_before_next_token(TSLexer *lexer, const bool *valid_symbols, ASILookahead next, bool leaving_expression) {
    if (next == ASI_SLASH) return valid_symbols[ARROW_FUNCTION_END];
    if (next != ASI_NEXT_TOKEN) return false;
    int32_t c = lexer->lookahead;
    return (valid_symbols[ARROW_FUNCTION_END] && (c == '`' || c == '[' || (leaving_expression && c == '*'))) ||
           (valid_symbols[POSTFIX_UPDATE_END] && c == '`');
}

// The trivia scan can already have consumed the prefix of an operator.
static bool semicolon_before_lookahead(TSLexer *lexer, const bool *valid_symbols, ASILookahead next,
                                      bool declaration_end, bool defer_binding) {
    if (next == ASI_SLASH) {
        return !valid_symbols[LOGICAL_OR] && (!declaration_end || !defer_binding);
    }
    if (next == ASI_NEXT_TOKEN && valid_symbols[LEXICAL_DECLARATION_BINDING] &&
        is_identifier_part(lexer->lookahead) && !is_digit(lexer->lookahead)) {
        return scan_word_after_let(lexer);
    }
    return semicolon_before_next_token(lexer, valid_symbols, declaration_end, defer_binding, lexer->lookahead);
}

// Attach the lookahead decision to the subtree so it survives reuse.
static bool remember_lookahead(Scanner *scanner, TSLexer *lexer, uint16_t pending_token) {
    scanner->pending_token = pending_token;
    lexer->result_symbol = DECLARATION_END;
    return true;
}

// The only identifier-like tokens that can continue an await using expression here are binary operators.
static bool starts_using_binding(TSLexer *lexer) {
    if (!is_identifier_part(lexer->lookahead) || is_digit(lexer->lookahead)) return false;
    return !starts_in_operator(lexer, false);
}

// The end is marked before the trivia so the ordinary lexer still emits all extras.
static bool scan_await_using(const Scanner *scanner, TSLexer *lexer, const bool *valid_symbols,
                             bool newline, bool asi_for_identifier) {
    if (!consume_word(lexer, "using", false)) return asi_for_identifier;
    if (is_identifier_part(lexer->lookahead)) return asi_for_identifier;
    ASITrivia after_using = {0};
    ASILookahead next = scan_asi_trivia(lexer, &after_using, false, RANGE_STOP);
    bool binding = next == ASI_NEXT_TOKEN && !after_using.newline && starts_using_binding(lexer);
    if (binding && (!newline || (context_flags(scanner) & AWAIT_CONTEXT))) {
        lexer->result_symbol = AWAIT_USING;
        return true;
    }
    if (newline) {
        if (scanner->depth || !valid_symbols[AUTOMATIC_SEMICOLON]) {
            lexer->result_symbol = AWAIT_OPERAND_CONTINUES;
            return valid_symbols[AWAIT_OPERAND_CONTINUES];
        }
        if (next == ASI_NEXT_TOKEN && !after_using.newline && lexer->lookahead == '=') {
            advance(lexer);
            // A bare arrow is not a unary operand of await.
            if (lexer->lookahead == '>') return true;
        }
        lexer->result_symbol = AWAIT_USING_ASI;
        return valid_symbols[AWAIT_USING_ASI];
    }
    lexer->result_symbol = AWAIT_USING;
    return next == ASI_END && !lexer->eof(lexer);
}

static bool scan_automatic_semicolon(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols, bool *try_ternary,
                                     bool *at_comparison_gt, bool *at_next_token) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    // A visible ASCII token cannot start ASI trivia; an included-range boundary can still end a statement.
    int32_t c = lexer->lookahead;
    if (c > 0 && c < 0x80 && c != '/' && c != '}' && !(c == 'u' && valid_symbols[AWAIT_USING]) &&
        !is_extra_space(c) && !lexer->is_at_included_range_start(lexer)) {
        *at_next_token = true;
        *try_ternary = c == '?';
        *at_comparison_gt = c == '>';
        return false;
    }

    ASITrivia trivia = {0};
    ASILookahead next = scan_asi_trivia(lexer, &trivia, false, RANGE_BETWEEN_TOKENS);
    *at_next_token = !trivia.comment && !trivia.newline && next == ASI_NEXT_TOKEN;
    *try_ternary = !trivia.comment && next == ASI_NEXT_TOKEN && lexer->lookahead == '?';
    // Reuse can skip the lexer state that allows || and defers ASI across trailing comments.
    // A reduced statement tail still allows await-using ASI, without the binding or keyword markers.
    bool reduced_expression = valid_symbols[AWAIT_USING_ASI] && !valid_symbols[DECLARATION_END] &&
                              !valid_symbols[BINDING_END] && !valid_symbols[CONTEXT_IDENTIFIER] &&
                              !valid_symbols[RESTRICTED_KEYWORD] && scanner->pending_token != DECLARATION_PENDING;
    bool defer_comments = valid_symbols[LOGICAL_OR] || reduced_expression;
    bool async_field = valid_symbols[RESTRICTED_KEYWORD] && valid_symbols[BINDING_END];
    bool restricted = valid_symbols[RESTRICTED_KEYWORD] && !async_field;
    if (valid_symbols[AWAIT_USING] && next == ASI_NEXT_TOKEN && lexer->lookahead == 'u') {
        *at_next_token = false;
        bool defer_asi = valid_symbols[LOGICAL_OR] && !trivia.leading_non_cr_break &&
                         (trivia.break_after_comment || valid_symbols[AWAIT_OPERAND_CONTINUES]);
        bool asi_for_identifier = trivia.newline && (restricted || !defer_asi);
        return scan_await_using(scanner, lexer, valid_symbols, trivia.newline, asi_for_identifier);
    }
    if (next == ASI_END) {
        if (!lexer->eof(lexer)) return true;
        // A trailing comment can be lexed as an extra before the ordinary EOF insertion.
        bool defer_eof = !restricted && defer_comments && !trivia.leading_non_cr_break &&
                         (trivia.line_comment || trivia.ends_at_block_comment);
        return !defer_eof;
    }
    if (next == ASI_NEXT_TOKEN && lexer->lookahead == '}') {
        // After a destructuring pattern a colon can start its type annotation.
        // In an expression, the colon can instead belong to a ternary.
        if (valid_symbols[LOGICAL_OR]) {
            return true;
        }
        skip(lexer);
        ASILookahead after_brace = scan_asi_trivia(lexer, &trivia, false, RANGE_BETWEEN_TOKENS);
        return after_brace != ASI_NEXT_TOKEN || lexer->lookahead != ':';
    }
    if (trivia.newline && ends_before_next_token(lexer, valid_symbols, next, false)) return true;
    *at_comparison_gt = !trivia.comment && next == ASI_NEXT_TOKEN && lexer->lookahead == '>';
    if (!trivia.newline) return false;

    // After return, break and continue, a line terminator ends the statement unless a ';' follows.
    if (restricted) {
        return next != ASI_NEXT_TOKEN || lexer->lookahead != ';';
    }

    // Leave room for the await operand or for extras to consume a comment before the next scan.
    if (defer_comments && !trivia.leading_non_cr_break &&
        (trivia.break_after_comment || valid_symbols[AWAIT_OPERAND_CONTINUES])) {
        return false;
    }
    bool saved_declaration = scanner->pending_token == DECLARATION_PENDING;
    bool declaration_end = (valid_symbols[DECLARATION_END] || saved_declaration) && !valid_symbols[LOGICAL_OR];
    bool defer_binding = trivia.non_cr_break_after_comment && (trivia.leading_non_cr_break || trivia.can_defer_binding);
    if (async_field && next == ASI_NEXT_TOKEN && (lexer->lookahead == '*' || lexer->lookahead == '[')) {
        return true;
    }
    // Mark before any comments are shifted so they keep their original parent after reduction.
    bool remember_declaration = declaration_end && !saved_declaration && trivia.comment;
    if (!semicolon_before_lookahead(lexer, valid_symbols, next, declaration_end,
                                    defer_binding && !remember_declaration)) return false;
    if (remember_declaration) return remember_lookahead(scanner, lexer, DECLARATION_PENDING);
    return true;
}

// A line break before an operand or '*' cannot be skipped, even where ASI is unavailable.
static bool scan_yield_operand(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    lexer->mark_end(lexer);
    ASITrivia trivia = {0};
    ASILookahead next = scan_asi_trivia(lexer, &trivia, false, RANGE_IGNORE);
    if (next == ASI_NEXT_TOKEN) {
        int32_t c = lexer->lookahead;
        if (c == ';' || c == ',' || c == ':' || c == ')' || c == ']') {
            return false;
        }
    }
    if (next == ASI_END || (next == ASI_NEXT_TOKEN && lexer->lookahead == '}')) {
        lexer->result_symbol = AUTOMATIC_SEMICOLON;
        return valid_symbols[AUTOMATIC_SEMICOLON];
    }
    if (trivia.newline) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return remember_lookahead(scanner, lexer, ASI_PENDING);
        }
        lexer->result_symbol = YIELD_LINE_TERMINATOR;
        return true;
    }
    lexer->result_symbol = YIELD_OPERAND;
    return true;
}

static bool scan_ternary_qmark(TSLexer *lexer) {
    advance(lexer);
    if (lexer->lookahead == '?') return false;

    lexer->mark_end(lexer);
    lexer->result_symbol = TERNARY_QMARK;
    // In TypeScript, optional parameters and members can have ':', ')' or ',' after '?'.
    while (is_extra_space(lexer->lookahead)) advance(lexer);
    switch (lexer->lookahead) {
        case ':':
        case ')':
        case ',':
            return false;
        case '.':
            // Optional chaining excludes a decimal digit immediately after the dot.
            advance(lexer);
            return is_digit(lexer->lookahead);
        default:
            return true;
    }
}

// After an `&`: is what follows the rest of an HTML character reference
// (`&amp;`, `&#38;`, `&#x26;`), as the grammar's html_character_reference
// token defines it? Consumes the name or number either way.
// ASCII comparisons, not isw*: those match non-ASCII digits on some C runtimes.
static bool scan_character_reference_tail(TSLexer *lexer) {
    unsigned length = 0;
    if (lexer->lookahead == '#') {
        advance(lexer);
        if (lexer->lookahead == 'x' || lexer->lookahead == 'X') {
            advance(lexer);
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

static bool scan_jsx_attribute_string(TSLexer *lexer, bool double_quote) {
    int32_t quote = double_quote ? '"' : '\'';
    lexer->result_symbol = double_quote ? JSX_DOUBLE_STRING_FRAGMENT : JSX_SINGLE_STRING_FRAGMENT;
    bool has_text = false;

    while (lexer->lookahead != quote && (lexer->lookahead != 0 || !lexer->eof(lexer))) {
        if (lexer->lookahead == '&') {
            lexer->mark_end(lexer);
            advance(lexer);
            // Keep the trailing ampersand in its own fragment.
            if (has_text && lexer->lookahead == quote) return true;
            if (scan_character_reference_tail(lexer)) {
                if (!has_text) {
                    advance(lexer);
                    lexer->mark_end(lexer);
                    lexer->result_symbol = JSX_ATTRIBUTE_CHARACTER_REFERENCE;
                }
                return true;
            }
        } else {
            advance(lexer);
        }
        has_text = true;
    }

    lexer->mark_end(lexer);
    return has_text;
}

static bool scan_jsx_text(TSLexer *lexer) {
    bool saw_text = false;
    bool at_newline = false;

    lexer->result_symbol = JSX_TEXT;

    while (!lexer->eof(lexer) && lexer->lookahead != '<' && lexer->lookahead != '>' && lexer->lookahead != '{' &&
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
        if (lexer->lookahead == '\n') {
            at_newline = true;
        } else if (!at_newline || !is_jsx_space(lexer->lookahead)) {
            saw_text = true;
            at_newline = false;
        }

        advance(lexer);
    }

    lexer->mark_end(lexer);
    return saw_text;
}

// End 'static' before a comment-separated member or the legacy 'static get' token before a generator.
static bool scan_static_modifier(TSLexer *lexer) {
    if (!consume_word(lexer, "static", false)) return false;
    lexer->mark_end(lexer);
    if (!is_extra_space(lexer->lookahead) && lexer->lookahead != '/') return false;
    ASITrivia prefix = {0};
    if (scan_asi_trivia(lexer, &prefix, true, RANGE_BETWEEN_TOKENS) != ASI_NEXT_TOKEN) return false;

    lexer->result_symbol = STATIC_BEFORE_GET_FIELD;
    int32_t next_char = lexer->lookahead;
    if (prefix.comment && prefix.newline &&
        (is_identifier_part(next_char) || next_char == '#' || next_char == '[' || next_char == '*' ||
         next_char == '"' || next_char == '\'')) {
        return true;
    }
    if (!consume_word(lexer, "get", false)) return false;
    ASITrivia trivia = {0};
    ASILookahead next = scan_asi_trivia(lexer, &trivia, true, RANGE_BETWEEN_TOKENS);
    return next == ASI_NEXT_TOKEN && trivia.newline && lexer->lookahead == '*';
}

static bool scan_identifier_word(TSLexer *lexer, const char *keyword) {
    return consume_word(lexer, keyword, false) && !is_identifier_part(lexer->lookahead);
}

static bool scan_context_word(const Scanner *scanner, TSLexer *lexer, bool keyword) {
    unsigned flags = context_flags(scanner);
    const char *word = NULL;
    if (lexer->lookahead == 'a' && (keyword || !(flags & AWAIT_CONTEXT))) {
        word = "await";
    } else if (lexer->lookahead == 'y' && !(flags & YIELD_CONTEXT)) {
        word = "yield";
    }
    if (!word || !consume_word(lexer, word, false)) return false;
    if (is_identifier_part(lexer->lookahead)) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = keyword ? CONTEXT_AWAIT : CONTEXT_IDENTIFIER;
    return true;
}

static bool leave_context(Scanner *scanner, TSLexer *lexer, enum TokenType symbol) {
    if (scanner->overflow) scanner->overflow--;
    else if (scanner->depth) scanner->depth--;
    lexer->result_symbol = symbol;
    return true;
}

static bool at_concise_body_end(TSLexer *lexer) {
    switch (lexer->lookahead) {
        case ',':
        case ':':
        case ';':
        case ')':
        case ']':
        case '}':
            return true;
        default:
            return false;
    }
}

static inline bool external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = payload;
    if (valid_symbols[ERROR_RECOVERY]) return false;
    if (valid_symbols[TEMPLATE_CHARS]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        return scan_template_chars(lexer);
    }

    if (scanner->pending_token == ASI_PENDING && valid_symbols[AUTOMATIC_SEMICOLON]) {
        scanner->pending_token = 0;
        lexer->mark_end(lexer);
        lexer->result_symbol = AUTOMATIC_SEMICOLON;
        return true;
    }

    // Quoted JSX attributes treat NUL as text.
    if (valid_symbols[JSX_ATTRIBUTE_CHARACTER_REFERENCE]) {
        return scan_jsx_attribute_string(lexer, valid_symbols[JSX_DOUBLE_STRING_FRAGMENT]);
    }

    if (valid_symbols[JSX_TEXT] && scan_jsx_text(lexer)) {
        return true;
    }

    if (valid_symbols[LEAVE_CONTEXT]) {
        lexer->mark_end(lexer);
        return leave_context(scanner, lexer, LEAVE_CONTEXT);
    }

    if (valid_symbols[ENTER_PLAIN_EXPRESSION] || valid_symbols[ENTER_ASYNC_ARROW]) {
        unsigned token = valid_symbols[ENTER_ASYNC_ARROW] ? ENTER_ASYNC_ARROW :
                         ENTER_PLAIN_EXPRESSION;
        lexer->mark_end(lexer);
        unsigned flags = 0;
        if (token == ENTER_ASYNC_ARROW) {
            ASITrivia trivia = {0};
            ASILookahead next = scan_asi_trivia(lexer, &trivia, true, RANGE_IGNORE);
            flags = AWAIT_CONTEXT;
            if (next != ASI_NEXT_TOKEN || lexer->lookahead != '{') flags |= ASYNC_ARROW_CONTEXT;
        }
        enter_context(scanner, flags);
        lexer->result_symbol = token;
        return true;
    }

    if (valid_symbols[LEAVE_SIGNATURE]) {
        lexer->mark_end(lexer);
        ASITrivia trivia = {0};
        if (scan_asi_trivia(lexer, &trivia, false, RANGE_IGNORE) == ASI_SLASH) return false;
        switch (lexer->lookahead) {
            case '[':
                if (trivia.newline) return leave_context(scanner, lexer, LEAVE_SIGNATURE);
                break;
            case '{':
            case ':':
            case '<':
            case '>':
            case '.':
            case '?':
            case '|':
            case '&':
                break;
            case 'e':
                if (scan_identifier_word(lexer, "extends")) return false;
                return leave_context(scanner, lexer, LEAVE_SIGNATURE);
            case 'i':
                if (scan_identifier_word(lexer, "is")) return false;
                return leave_context(scanner, lexer, LEAVE_SIGNATURE);
            default:
                return leave_context(scanner, lexer, LEAVE_SIGNATURE);
        }
        if (trivia.comment) return false;
    }

    if (valid_symbols[YIELD_OPERAND]) {
        return scan_yield_operand(scanner, lexer, valid_symbols);
    }

    if (valid_symbols[LEAVE_CONCISE_BODY]) {
        // Keep the body end at the previous token and look past an included-range boundary.
        lexer->mark_end(lexer);
        ASITrivia trivia = {0};
        ASILookahead next = scan_asi_trivia(lexer, &trivia, false, RANGE_IGNORE);
        if (next == ASI_END || (next == ASI_NEXT_TOKEN && at_concise_body_end(lexer)) ||
            (trivia.newline && (ends_before_next_token(lexer, valid_symbols, next, true) ||
                                semicolon_before_lookahead(lexer, valid_symbols, next, false, false)))) {
            return leave_context(scanner, lexer, LEAVE_CONCISE_BODY);
        }
        if (trivia.comment || next != ASI_NEXT_TOKEN) return false;
        if (lexer->lookahead == '?' && valid_symbols[TERNARY_QMARK]) return scan_ternary_qmark(lexer);
        if (lexer->lookahead == '>' && valid_symbols[COMPARISON_GT]) return scan_comparison_gt(lexer);
        if (trivia.newline) return false;
    } else if (valid_symbols[AUTOMATIC_SEMICOLON] || valid_symbols[FUNCTION_SIGNATURE_AUTOMATIC_SEMICOLON]) {
        bool try_ternary = false, at_comparison_gt = false, at_next_token = false;
        if (scan_automatic_semicolon(scanner, lexer, valid_symbols, &try_ternary, &at_comparison_gt, &at_next_token)) {
            if (scanner->pending_token == DECLARATION_PENDING && lexer->result_symbol != DECLARATION_END) {
                scanner->pending_token = 0;
            }
            return true;
        }
        if (at_comparison_gt && valid_symbols[COMPARISON_GT]) return scan_comparison_gt(lexer);
        if (try_ternary && valid_symbols[TERNARY_QMARK]) return scan_ternary_qmark(lexer);
        if (!at_next_token) return false;
    } else {
        lexer->mark_end(lexer);
    }

    if (valid_symbols[AWAIT_USING] && !valid_symbols[AUTOMATIC_SEMICOLON]) {
        ASITrivia trivia = {0};
        ASILookahead next = scan_asi_trivia(lexer, &trivia, false, RANGE_STOP);
        if (next == ASI_NEXT_TOKEN && lexer->lookahead == 'u') {
            return scan_await_using(scanner, lexer, valid_symbols, trivia.newline, false);
        }
        // With no using operand, leave the top-level identifier alternative to its ordinary lexer.
        if (next == ASI_END && !lexer->eof(lexer)) {
            lexer->result_symbol = AWAIT_USING;
            return true;
        }
        // Ordinary comments must be emitted before we scan a contextual identifier.
        if (trivia.comment || next != ASI_NEXT_TOKEN) return false;
    }

    bool enter = valid_symbols[ENTER_STATIC_BLOCK] || valid_symbols[ENTER_PLAIN] || valid_symbols[ENTER_AWAIT] ||
                 valid_symbols[ENTER_YIELD] || valid_symbols[ENTER_BOTH];
    // The inherited HTML comment slot marks code rows. TypeScript never emits it.
    if (valid_symbols[HTML_COMMENT] && !valid_symbols[ESCAPE_SEQUENCE] && !valid_symbols[REGEX_PATTERN]) {
        while (is_extra_space(lexer->lookahead)) skip(lexer);
    }
    if (enter) {
        unsigned token = ENTER_PLAIN_EXPRESSION;
        if (valid_symbols[ENTER_STATIC_BLOCK] && lexer->lookahead == '{') {
            token = ENTER_STATIC_BLOCK;
        } else if (lexer->lookahead == '(' || lexer->lookahead == '<') {
            for (token = ENTER_PLAIN; token < ENTER_PLAIN_EXPRESSION && !valid_symbols[token]; token++) {}
        }

        if (token != ENTER_PLAIN_EXPRESSION) {
            enter_context(scanner, token == ENTER_STATIC_BLOCK ? AWAIT_CONTEXT : token - ENTER_PLAIN);
            lexer->result_symbol = token;
            return true;
        }
    }

    if (lexer->lookahead == 'a' && valid_symbols[CONTEXT_AWAIT] && (context_flags(scanner) & ASYNC_ARROW_CONTEXT)) {
        return scan_context_word(scanner, lexer, true);
    }
    if (valid_symbols[CONTEXT_IDENTIFIER] && (lexer->lookahead == 'a' || lexer->lookahead == 'y')) {
        return scan_context_word(scanner, lexer, false);
    }

    if (valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
        return scan_ternary_qmark(lexer);
    }
    if (valid_symbols[STATIC_BEFORE_GET_FIELD] && lexer->lookahead == 's') {
        return scan_static_modifier(lexer);
    }

    return valid_symbols[COMPARISON_GT] && scan_comparison_gt(lexer);
}
