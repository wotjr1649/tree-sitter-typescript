import XCTest
import SwiftTreeSitter
import TreeSitterTypeScript
import TreeSitterTSX

final class TreeSitterTypeScriptTests: XCTestCase {
    func testCanLoadTypeScriptGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_typescript())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading TypeScript grammar")
        let tree = try XCTUnwrap(parser.parse("let x: number = 1;"))
        XCTAssertEqual(tree.rootNode?.hasError, false)
    }

    func testCanLoadTSXGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_tsx())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading TSX grammar")
        let tree = try XCTUnwrap(parser.parse("const a = <div />;"))
        XCTAssertEqual(tree.rootNode?.hasError, false)
    }
}
