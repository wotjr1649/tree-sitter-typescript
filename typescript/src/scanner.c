#include "../../common/scanner.h"

void *tree_sitter_typescript_external_scanner_create() { return scope_create(); }

void tree_sitter_typescript_external_scanner_destroy(void *payload) { scope_destroy(payload); }

unsigned tree_sitter_typescript_external_scanner_serialize(void *payload, char *buffer) { return scope_serialize(payload, buffer); }

void tree_sitter_typescript_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) { scope_deserialize(payload, buffer, length); }

bool tree_sitter_typescript_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    return external_scanner_scan(payload, lexer, valid_symbols);
}
