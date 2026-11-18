from unittest import TestCase

import tree_sitter, tree_sitter_typescript


class TestLanguage(TestCase):
    def test_can_load_typescript_grammar(self):
        parser = tree_sitter.Parser(tree_sitter.Language(tree_sitter_typescript.language_typescript()))
        tree = parser.parse(b"let x: number = 1;")
        self.assertFalse(tree.root_node.has_error)

    def test_can_load_tsx_grammar(self):
        parser = tree_sitter.Parser(tree_sitter.Language(tree_sitter_typescript.language_tsx()))
        tree = parser.parse(b"const a = <div />;")
        self.assertFalse(tree.root_node.has_error)
