/**
 * @file JavaScript grammar for tree-sitter
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#reserved_words
const RESERVED_WORDS = [
  'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with',
];

const CONTEXTUAL_KEYWORDS = [
  'get', 'set', 'async', 'await', 'static', 'let', 'using',
];

module.exports = grammar({
  name: 'javascript',

  externals: $ => [
    $._automatic_semicolon,
    $._template_chars,
    $._ternary_qmark,
    $.html_comment,
    '||',
    // We use escape sequence and regex pattern to tell the scanner if we're currently inside a string or template string, in which case
    // it should NOT parse html comments.
    $.escape_sequence,
    $.regex_pattern,
    $.jsx_text,
    // Never produced: the scanner only reads whether they are valid, to tell apart parse states that look the same to
    // it when it decides on an automatic semicolon. Valid after a class field name without an initializer...
    $._binding_end,
    // ...and after a keyword that may still go on: before a declarator (`let`, `using`) or a property name (`get`,
    // `set`, `static`, `async` in a class).
    $._keyword_continues,
    // Never produced: the scanner only reads whether it is valid, after `return`, `break`, `continue` and a label, where a
    // lone CR ends the statement like any other line terminator (ECMA-262 12.9.1: no LineTerminator here).
    $._restricted_keyword,
    // Preserve a bare declaration or yield expression's lookahead decision across incremental reuse.
    $._declaration_end,
    // Only the validity of this marker is used, to tell a modifier from a field before '*'.
    $._generator_method_continues,
    $._static_before_get_field,
    // A line break before using can select the await operand instead of the declaration.
    $._await_operand_continues,
    // The scanner returns the same identifier token for await and yield when their keyword is inactive.
    $.identifier,
    $._enter_plain,
    $._enter_await,
    $._enter_yield,
    $._enter_both,
    $._enter_plain_expression,
    $._enter_async_arrow,
    $._enter_static_block,
    $._leave_context,
    $._leave_concise_body,
    $._yield_operand,
    $._yield_line_terminator,
    // Replay the next Annex B extra after deciding whether the preceding construct ends.
    $._annex_prefix,
    // A declaration requires both gaps in await using Binding to have no line terminator.
    $._await_using,
    $._jsx_attribute_character_reference,
    $._jsx_double_string_fragment,
    $._jsx_single_string_fragment,
    // ASI reads these markers after a completed arrow or postfix update.
    $._arrow_function_end,
    $._postfix_update_end,
    // A line break before using can also end a Script statement.
    $._await_using_asi,
    $._context_await,
  ],

  extras: $ => [
    $.comment,
    $.html_comment,
    $._annex_prefix,
    /[\s\p{Zs}\uFEFF\u2028\u2029\u2060\u200B]/,
  ],

  reserved: {
    global: $ => RESERVED_WORDS,
    properties: $ => [],
  },

  supertypes: $ => [
    $.statement,
    $.declaration,
    $.expression,
    $.primary_expression,
    $.pattern,
  ],

  inline: $ => [
    $._call_signature,
    $._formal_parameter,
    $._expressions,
    $._semicolon,
    $._identifier,
    $._reserved_identifier,
    $._jsx_attribute,
    $._jsx_element_name,
    $._jsx_child,
    $._jsx_element,
    $._jsx_attribute_name,
    $._jsx_attribute_value,
    $._jsx_identifier,
    $._lhs_expression,
    $._keyword_identifier,
    $._jsx_keyword_identifier,
    $._await_keyword,
    $._await_operand,
    $._postfix_expression,
  ],

  precedences: $ => [
    [
      'member',
      'template_call',
      'call',
      $.update_expression,
      'unary_void',
      'binary_exp',
      'binary_times',
      'binary_plus',
      'binary_shift',
      'binary_compare',
      'binary_relation',
      'binary_equality',
      'bitwise_and',
      'bitwise_xor',
      'bitwise_or',
      'logical_and',
      'logical_or',
      'ternary',
      $.sequence_expression,
      $.arrow_function,
    ],
    ['assign', $.primary_expression],
    // Postfix operators can extend the operand before await reduces.
    ['member', 'template_call', 'new', 'call', $.update_expression, 'unary_void', $.expression],
    ['declaration', 'literal'],
    [$.primary_expression, $.statement_block, 'object'],
    [$.meta_property, $.import],
    [$.import_statement, $.import],
    [$.export_statement, $.primary_expression],
    [$.lexical_declaration, $.primary_expression],
    [$._for_lexical_declaration, $.primary_expression],
    // `for await (let [a] of b)` has no lexical_declaration item to outrank `let` as an identifier: the declaration wins.
    ['for_let', $.primary_expression],
    // Unlike `let [`, `using [` starts an expression: a using declaration binds identifiers only.
    [$.primary_expression, $.using_declaration],
    [$.primary_expression, $._for_using_declaration],
  ],

  conflicts: $ => [
    [$.primary_expression, $._nonordinary_method_head],
    [$.primary_expression, $._property_name],
    [$.primary_expression, $.await_expression],
    [$.primary_expression, $.await_expression, $._property_name],
    [$.primary_expression, $.arrow_function],
    [$.primary_expression, $.arrow_function, $._property_name],
    [$.primary_expression, $.method_definition],
    [$.primary_expression, $._ordinary_method_name],
    [$.primary_expression, $.rest_pattern],
    [$.primary_expression, $.pattern],
    [$.primary_expression, $._for_header],
    [$.array, $.array_pattern],
    [$.object, $.object_pattern],
    [$.assignment_expression, $.pattern],
    [$.assignment_expression, $.object_assignment_pattern],
    [$.labeled_statement, $._property_name],
    [$.computed_property_name, $.array],
    [$.binary_expression, $._initializer],
    [$.class_static_block, $._property_name],
  ],

  word: $ => $.identifier,

  rules: {
    program: $ => seq(
      optional($.hash_bang_line),
      repeat($.statement),
    ),

    // U+0000 in a repeated character class: `\x00+` gives it a transition of its own. Merged into a negated class
    // (`[^x]|\x00`) the generated lexer drops it, as `lookahead != 0` also means the end of the input.
    hash_bang_line: _ => /#!([^\r\n\u2028\u2029\x00]|\x00+)*/,

    //
    // Export declarations
    //

    export_statement: $ => choice(
      seq(
        'export',
        choice(
          seq(choice('*', $.namespace_export, $.export_clause), $._from_clause, optional($._import_attributes)),
          $.export_clause,
        ),
        $._semicolon,
      ),
      seq(
        repeat(field('decorator', $.decorator)),
        'export',
        choice(
          field('declaration', $.declaration),
          seq(
            'default',
            choice(
              field('declaration', $.declaration),
              // An anonymous function or class here is a declaration (ECMA-262 16.2.3), not an expression statement:
              // what follows, ';' included, is the next statement.
              prec(1, field('value', choice($.function_expression, $.generator_function, $.class))),
              seq(
                field('value', $.expression),
                $._semicolon,
              ),
            ),
          ),
        ),
      ),
    ),

    namespace_export: $ => seq(
      '*', 'as', $._module_export_name,
    ),

    export_clause: $ => seq(
      '{',
      commaSep($.export_specifier),
      optional(','),
      '}',
    ),

    export_specifier: $ => seq(
      field('name', $._module_export_name),
      optional(seq(
        'as',
        field('alias', $._module_export_name),
      )),
    ),

    // Any IdentifierName, reserved words included (`export { a as if }`, `import { if as a } from 'x'`).
    _module_export_name: $ => reserved('properties', choice(
      $.identifier,
      $.string,
      'default',
    )),

    declaration: $ => choice(
      $.function_declaration,
      $.generator_function_declaration,
      $.class_declaration,
      $.lexical_declaration,
      $.variable_declaration,
      $.using_declaration,
    ),

    //
    // Import declarations
    //

    import: _ => token('import'),

    import_statement: $ => seq(
      'import',
      choice(
        seq($.import_clause, $._from_clause),
        field('source', $.string),
      ),
      optional($._import_attributes),
      $._semicolon,
    ),

    import_clause: $ => choice(
      $.namespace_import,
      $.named_imports,
      seq(
        $.identifier,
        optional(seq(
          ',',
          choice(
            $.namespace_import,
            $.named_imports,
          ),
        )),
      ),
    ),

    _from_clause: $ => seq(
      'from', field('source', $.string),
    ),

    namespace_import: $ => seq(
      '*', 'as', $.identifier,
    ),

    named_imports: $ => seq(
      '{',
      commaSep($.import_specifier),
      optional(','),
      '}',
    ),

    import_specifier: $ => choice(
      field('name', $.identifier),
      seq(
        field('name', $._module_export_name),
        'as',
        field('alias', $.identifier),
      ),
    ),

    import_attribute: $ => seq('with', alias($._attributes_object, $.object)),

    // WithClause (ECMA-262 §16.2.2): IdentifierName or string keys, string values, the tree of an object.
    _attributes_object: $ => seq(
      '{',
      optional(seq(commaSep1(alias($._attribute_pair, $.pair)), optional(','))),
      '}',
    ),

    _attribute_pair: $ => seq(
      field('key', reserved('properties', choice(alias($.identifier, $.property_identifier), $.string))),
      ':',
      field('value', $.string),
    ),

    // `with` is a keyword that can follow a line break here, so the automatic semicolon the scanner inserts before it
    // must not end the statement: the precedence makes the attributes win over a `with` statement after it.
    _import_attributes: $ => choice(
      $.import_attribute,
      prec(1, seq($._automatic_semicolon, $.import_attribute)),
    ),

    //
    // Statements
    //

    statement: $ => choice(
      $.export_statement,
      $.import_statement,
      $.debugger_statement,
      $.expression_statement,
      $.declaration,
      $.statement_block,

      $.if_statement,
      $.switch_statement,
      $.for_statement,
      $.for_in_statement,
      $.while_statement,
      $.do_statement,
      $.try_statement,
      $.with_statement,

      $.break_statement,
      $.continue_statement,
      $.return_statement,
      $.throw_statement,
      $.empty_statement,
      $.labeled_statement,
    ),

    expression_statement: $ => seq(
      $._expressions,
      $._semicolon,
    ),

    variable_declaration: $ => seq(
      'var',
      commaSep1($.variable_declarator),
      $._semicolon,
    ),

    lexical_declaration: $ => seq(
      field('kind', choice('let', 'const')),
      commaSep1($.variable_declarator),
      $._semicolon,
    ),

    using_declaration: $ => usingDeclaration($, $._semicolon),

    _for_variable_declaration: $ => seq('var', commaSep1($.variable_declarator), ';'),

    _for_lexical_declaration: $ => seq(field('kind', choice('let', 'const')), commaSep1($.variable_declarator), ';'),

    _for_using_declaration: $ => usingDeclaration($, ';'),

    // A plain `for` initializer ends at a real `;`. Share the states after the declaration across all three forms.
    _for_declaration: $ => choice(
      alias($._for_lexical_declaration, $.lexical_declaration),
      alias($._for_variable_declaration, $.variable_declaration),
      alias($._for_using_declaration, $.using_declaration),
    ),

    _using_keyword_declarator: $ => seq(
      field('name', alias(choice('as', 'satisfies'), $.identifier)),
      optional(choice($._initializer, $._declaration_end)),
    ),

    _identifier_declarator: $ => seq(
      optional($._keyword_continues),
      field('name', choice($.identifier, alias('of', $.identifier))),
      optional(choice($._initializer, $._declaration_end)),
    ),

    _using_declarator: $ => alias($._identifier_declarator, $.variable_declarator),

    variable_declarator: $ => choice(
      $._identifier_declarator,
      seq(optional($._keyword_continues), field('name', $._destructuring_pattern), $._initializer),
    ),

    // A statement that starts with `{` is a block, never an object (ECMA-262: an ExpressionStatement cannot start with
    // `{`). `{a:0}` reads both ways; `labeled_statement` has dynamic precedence -1, so the block needs more than 1 to win.
    statement_block: $ => prec.dynamic(2, prec.right(seq(
      '{',
      repeat($.statement),
      '}',
      optional($._automatic_semicolon),
    ))),

    else_clause: $ => seq('else', $.statement),

    if_statement: $ => prec.right(seq(
      'if',
      field('condition', $.parenthesized_expression),
      field('consequence', $.statement),
      optional(field('alternative', $.else_clause)),
    )),

    switch_statement: $ => seq(
      'switch',
      field('value', $.parenthesized_expression),
      field('body', $.switch_body),
    ),

    for_statement: $ => seq(
      'for',
      '(',
      choice(
        field('initializer', $._for_declaration),
        seq(field('initializer', $._expressions), ';'),
        field('initializer', $.empty_statement),
      ),
      field('condition', choice(
        seq($._expressions, ';'),
        $.empty_statement,
      )),
      field('increment', optional($._expressions)),
      ')',
      field('body', $.statement),
    ),

    for_in_statement: $ => seq(
      'for',
      optional('await'),
      $._for_header,
      field('body', $.statement),
    ),

    _for_header: $ => seq(
      '(',
      choice(
        seq(
          choice(
            field('left', choice(
              $._lhs_expression,
              $.parenthesized_expression,
              $.call_expression,
            )),
            // `using` and a line break is an identifier, not a declaration (`for (using\nof y)`): the automatic
            // semicolon there makes a declarator after the line break an error.
            seq(field('left', alias('using', $.identifier)), $._automatic_semicolon),
            seq(
              field('kind', 'var'),
              field('left', choice(
                $.identifier,
                alias('of', $.identifier),
                $._destructuring_pattern,
              )),
              optional($._initializer),
            ),
            prec('for_let', seq(
              field('kind', choice('let', 'const')),
              field('left', choice(
                $.identifier,
                alias('of', $.identifier),
                $._destructuring_pattern,
              )),
              optional($._automatic_semicolon),
            )),
          ),
          field('operator', choice('in', 'of')),
        ),
        // A using declaration starts a `for…of` head only: `for…in` passes ~Using to ForDeclaration (ECMA-262 §14.7.5).
        seq(
          field('kind', 'using'),
          field('left', choice(
            $.identifier,
            // Not `of`: `for (using of of[0])` is the expression `using` over `of[0]` (the grammar has [lookahead ≠ using of]).
            // In TypeScript, `using as` and `using satisfies` can also start an expression, so these lex as keywords.
            alias(choice('as', 'satisfies'), $.identifier),
            $._destructuring_pattern,
          )),
          optional($._automatic_semicolon),
          field('operator', 'of'),
        ),
        seq(
          field('kind', seq($._await_keyword, $._await_using, 'using')),
          field('left', choice(
            $.identifier,
            alias('of', $.identifier),
            alias(choice('as', 'satisfies'), $.identifier),
            $._destructuring_pattern,
          )),
          optional($._automatic_semicolon),
          field('operator', 'of'),
        ),
      ),
      field('right', $._expressions),
      ')',
    ),

    while_statement: $ => seq(
      'while',
      field('condition', $.parenthesized_expression),
      field('body', $.statement),
    ),

    do_statement: $ => prec.right(seq(
      'do',
      field('body', $.statement),
      'while',
      field('condition', $.parenthesized_expression),
      optional($._semicolon),
    )),

    try_statement: $ => seq(
      'try',
      field('body', $.statement_block),
      optional(field('handler', $.catch_clause)),
      optional(field('finalizer', $.finally_clause)),
    ),

    with_statement: $ => seq(
      'with',
      field('object', $.parenthesized_expression),
      field('body', $.statement),
    ),

    break_statement: $ => seq(
      'break',
      field('label', optional(alias($.identifier, $.statement_identifier))),
      optional($._restricted_keyword),
      $._semicolon,
    ),

    continue_statement: $ => seq(
      'continue',
      field('label', optional(alias($.identifier, $.statement_identifier))),
      optional($._restricted_keyword),
      $._semicolon,
    ),

    debugger_statement: $ => seq(
      'debugger',
      $._semicolon,
    ),

    return_statement: $ => seq(
      'return',
      optional($._restricted_keyword),
      optional($._expressions),
      $._semicolon,
    ),

    throw_statement: $ => seq(
      'throw',
      $._expressions,
      $._semicolon,
    ),

    empty_statement: _ => ';',

    labeled_statement: $ => prec.dynamic(-1, seq(
      field('label', alias(choice($.identifier, $._reserved_identifier), $.statement_identifier)),
      ':',
      field('body', $.statement),
    )),

    //
    // Statement components
    //

    switch_body: $ => seq(
      '{',
      repeat(choice($.switch_case, $.switch_default)),
      '}',
    ),

    switch_case: $ => seq(
      'case',
      field('value', $._expressions),
      ':',
      field('body', repeat($.statement)),
    ),

    switch_default: $ => seq(
      'default',
      ':',
      field('body', repeat($.statement)),
    ),

    catch_clause: $ => seq(
      'catch',
      optional(seq('(', field('parameter', choice($.identifier, $._destructuring_pattern)), ')')),
      field('body', $.statement_block),
    ),

    finally_clause: $ => seq(
      'finally',
      field('body', $.statement_block),
    ),

    parenthesized_expression: $ => seq(
      '(',
      $._expressions,
      ')',
    ),

    //
    // Expressions
    //
    _expressions: $ => choice(
      $.expression,
      $.sequence_expression,
    ),

    expression: $ => choice(
      $.primary_expression,
      $._jsx_element,
      $.assignment_expression,
      $.augmented_assignment_expression,
      $.await_expression,
      $.unary_expression,
      $.binary_expression,
      $.ternary_expression,
      $.update_expression,
      $.new_expression,
      $.yield_expression,
    ),

    primary_expression: $ => choice(
      $.subscript_expression,
      $.member_expression,
      $.parenthesized_expression,
      $._identifier,
      alias($._reserved_identifier, $.identifier),
      $.this,
      $.super,
      $.number,
      $.string,
      $.template_string,
      $.regex,
      $.true,
      $.false,
      $.null,
      $.object,
      $.array,
      $.function_expression,
      $.arrow_function,
      $.generator_function,
      $.class,
      $.meta_property,
      $.call_expression,
    ),

    yield_expression: $ => prec.right(seq(
      'yield',
      optional(choice(
        seq($._yield_operand, optional('*'), $.expression),
        // Require a semicolon for recovery if a line break cannot end the expression by ASI.
        seq($._yield_line_terminator, ';'),
        $._declaration_end,
      )),
    )),

    object: $ => prec('object', seq(
      '{',
      commaSep(optional(choice(
        $.pair,
        $.spread_element,
        $.method_definition,
        alias(
          choice($.identifier, $._reserved_identifier),
          $.shorthand_property_identifier,
        ),
      ))),
      '}',
    )),

    object_pattern: $ => prec('object', seq(
      '{',
      commaSep(optional(choice(
        $.pair_pattern,
        $.rest_pattern,
        $.object_assignment_pattern,
        alias(
          choice($.identifier, $._reserved_identifier),
          $.shorthand_property_identifier_pattern,
        ),
      ))),
      '}',
    )),

    assignment_pattern: $ => seq(
      field('left', $.pattern),
      '=',
      field('right', $.expression),
    ),

    object_assignment_pattern: $ => seq(
      field('left', choice(
        alias(choice($._reserved_identifier, $.identifier), $.shorthand_property_identifier_pattern),
        $._destructuring_pattern,
      )),
      '=',
      field('right', $.expression),
    ),

    array: $ => seq(
      '[',
      commaSep(optional(choice(
        $.expression,
        $.spread_element,
      ))),
      ']',
    ),

    array_pattern: $ => seq(
      '[',
      commaSep(optional(choice(
        $.pattern,
        $.assignment_pattern,
      ))),
      ']',
    ),

    _jsx_element: $ => choice($.jsx_element, $.jsx_self_closing_element),

    jsx_element: $ => seq(
      field('open_tag', $.jsx_opening_element),
      repeat($._jsx_child),
      field('close_tag', $.jsx_closing_element),
    ),

    // An entity can be named, numeric (decimal), or numeric (hexadecimal). The
    // longest entity name is 29 characters long, and the HTML spec says that
    // no more will ever be added.
    html_character_reference: _ => /&(#([xX][0-9a-fA-F]{1,6}|[0-9]{1,5})|[A-Za-z]{1,30});/,

    jsx_expression: $ => seq(
      '{',
      optional(choice(
        $.expression,
        $.sequence_expression,
        $.spread_element,
      )),
      '}',
    ),

    _jsx_child: $ => choice(
      $.jsx_text,
      $.html_character_reference,
      $._jsx_element,
      $.jsx_expression,
    ),

    jsx_opening_element: $ => prec.dynamic(-1, seq(
      '<',
      optional(seq(
        field('name', $._jsx_element_name),
        repeat(field('attribute', $._jsx_attribute)),
      )),
      '>',
    )),

    jsx_identifier: _ => /[a-zA-Z_$][a-zA-Z\d_$]*-[a-zA-Z\d_$\-]*/,

    // JSX names may be reserved words (`<class />`, `<Foo.class />`, `<C in={x} />`) and keep the node kinds of other
    // names. TSX refers to nested_identifier directly, so its property takes them too; its object does not, because
    // TypeScript's `namespace a.b` uses nested_identifier and a keyword there conflicts with `namespace in x`.
    _jsx_identifier: $ => choice(
      alias($.jsx_identifier, $.identifier),
      $.identifier,
      alias(choice($._jsx_keyword_identifier, $.this), $.identifier),
    ),

    // Contextual keywords already lex as identifiers here.
    _jsx_keyword_identifier: $ => choice(
      ...RESERVED_WORDS.filter(word => !['this', 'super', 'true', 'false', 'null'].includes(word)),
      $.super, $.true, $.false, $.null,
    ),

    nested_identifier: $ => prec('member', seq(
      field('object', choice($.identifier, alias($.nested_identifier, $.member_expression))),
      '.',
      field('property', alias(choice($.identifier, $._keyword_identifier), $.property_identifier)),
    )),

    // Keyword and hyphenated objects are JSX-only: TS uses nested_identifier in namespace and type paths.
    _jsx_keyword_member_expression: $ => prec('member', seq(
      field('object', choice(
        $.this,
        alias(choice($._jsx_keyword_identifier, $.jsx_identifier), $.identifier),
        alias($._jsx_keyword_member_expression, $.member_expression),
      )),
      '.',
      field('property', alias(choice($.identifier, $._keyword_identifier), $.property_identifier)),
    )),

    jsx_namespace_name: $ => seq($._jsx_identifier, ':', $._jsx_identifier),

    _jsx_element_name: $ => choice(
      $._jsx_identifier,
      alias($.nested_identifier, $.member_expression),
      alias($._jsx_keyword_member_expression, $.member_expression),
      $.jsx_namespace_name,
    ),

    jsx_closing_element: $ => seq(
      '</',
      optional(field('name', $._jsx_element_name)),
      '>',
    ),

    jsx_self_closing_element: $ => seq(
      '<',
      field('name', $._jsx_element_name),
      repeat(field('attribute', $._jsx_attribute)),
      '/>',
    ),

    _jsx_attribute: $ => choice(
      $.jsx_attribute,
      alias($._jsx_spread_attribute, $.jsx_expression),
    ),

    _jsx_spread_attribute: $ => seq('{', $.spread_element, '}'),

    _jsx_attribute_name: $ => choice(
      alias($._jsx_identifier, $.property_identifier),
      $.jsx_namespace_name,
    ),

    jsx_attribute: $ => seq(
      $._jsx_attribute_name,
      optional(seq(
        '=',
        $._jsx_attribute_value,
      )),
    ),

    _jsx_string: $ => choice(
      ...[
        ['"', $._jsx_double_string_fragment],
        ['\'', $._jsx_single_string_fragment],
      ].map(([quote, fragment]) => seq(
        quote,
        repeat(choice(
          alias(fragment, $.string_fragment),
          alias($._jsx_attribute_character_reference, $.html_character_reference),
        )),
        quote,
      )),
    ),

    _jsx_attribute_value: $ => choice(
      alias($._jsx_string, $.string),
      alias($._jsx_expression_attribute_value, $.jsx_expression),
      $._jsx_element,
    ),

    _jsx_expression_attribute_value: $ => seq('{', $.expression, '}'),

    class: $ => prec('literal', seq(
      repeat(field('decorator', $.decorator)),
      'class',
      field('name', optional($.identifier)),
      optional($.class_heritage),
      field('body', $.class_body),
    )),

    class_declaration: $ => prec('declaration', seq(
      repeat(field('decorator', $.decorator)),
      'class',
      field('name', $.identifier),
      optional($.class_heritage),
      field('body', $.class_body),
      optional($._automatic_semicolon),
    )),

    class_heritage: $ => seq('extends', $.expression),

    function_expression: $ => prec('literal', seq(
      choice(
        seq('function', field('name', optional($.identifier)), $._enter_plain),
        seq('async', 'function', field('name', optional($.identifier)), $._enter_await),
      ),
      $._call_signature,
      field('body', $.statement_block),
      $._leave_context,
    )),

    function_declaration: $ => prec.right('declaration', seq(
      choice(
        seq('function', field('name', $.identifier), $._enter_plain),
        seq('async', 'function', field('name', $.identifier), $._enter_await),
      ),
      $._call_signature,
      field('body', $.statement_block),
      $._leave_context,
      optional($._automatic_semicolon),
    )),

    generator_function: $ => prec('literal', seq(
      choice(
        seq('function', '*', field('name', optional($.identifier)), $._enter_yield),
        seq('async', 'function', '*', field('name', optional($.identifier)), $._enter_both),
      ),
      $._call_signature,
      field('body', $.statement_block),
      $._leave_context,
    )),

    generator_function_declaration: $ => prec.right('declaration', seq(
      choice(
        seq('function', '*', field('name', $.identifier), $._enter_yield),
        seq('async', 'function', '*', field('name', $.identifier), $._enter_both),
      ),
      $._call_signature,
      field('body', $.statement_block),
      $._leave_context,
      optional($._automatic_semicolon),
    )),

    arrow_function: $ => seq(
      choice(
        seq($._arrow_parameters, '=>', $._enter_plain_expression),
        seq('async', choice($._arrow_parameters, field('parameter', alias('of', $.identifier))), '=>', $._enter_async_arrow),
      ),
      choice(
        seq(field('body', $.expression), $._leave_concise_body),
        seq(field('body', $.statement_block), $._leave_context),
      ),
      optional($._arrow_function_end),
    ),

    _arrow_parameters: $ => choice(
      field('parameter', choice(alias($._reserved_identifier, $.identifier), $.identifier)),
      $._call_signature,
    ),

    // Override
    _call_signature: $ => field('parameters', $.formal_parameters),
    _formal_parameter: $ => choice($.pattern, $.assignment_pattern),

    optional_chain: _ => '?.',

    call_expression: $ => choice(
      prec('call', seq(
        field('function', choice($.expression, $._postfix_expression, $.import)),
        field('arguments', $.arguments),
      )),
      prec('template_call', seq(
        field('function', choice($.primary_expression, $.new_expression)),
        field('arguments', alias($._tagged_template_string, $.template_string)),
      )),
      prec('member', seq(
        field('function', $.primary_expression),
        field('optional_chain', $.optional_chain),
        field('arguments', $.arguments),
      )),
    ),

    new_expression: $ => prec.right('new', seq(
      'new',
      field('constructor', choice($.primary_expression, $.new_expression)),
      field('arguments', optional(prec.dynamic(1, $.arguments))),
    )),

    // Async arrows give their await keyword precedence over the Script identifier fallback.
    _await_keyword: $ => choice('await', alias($._context_await, 'await')),

    // Prefer the keyword interpretation when await has a unary operand.
    // A direct assignment is outside that operand, so `await(a).x=b` retains its identifier interpretation.
    await_expression: $ => prec.dynamic(1, prec('unary_void', seq(
      $._await_keyword,
      optional(choice($._await_operand_continues, $._await_using, $._await_using_asi)),
      $._await_operand,
    ))),

    _await_operand: $ => choice(
      $.primary_expression,
      $._jsx_element,
      $.await_expression,
      $.unary_expression,
      $.update_expression,
      $.new_expression,
    ),

    _postfix_expression: $ => choice($.primary_expression, $.new_expression, $._jsx_element),

    member_expression: $ => prec('member', seq(
      field('object', choice($.expression, $._postfix_expression, $.import)),
      choice('.', field('optional_chain', $.optional_chain)),
      field('property', choice(
        $.private_property_identifier,
        reserved('properties', alias(
          choice($.identifier, $._keyword_identifier),
          $.property_identifier,
        )),
      )),
    )),

    subscript_expression: $ => prec.right('member', seq(
      field('object', choice($.expression, $._postfix_expression)),
      optional(field('optional_chain', $.optional_chain)),
      '[', field('index', $._expressions), ']',
    )),

    _lhs_expression: $ => choice(
      $.member_expression,
      $.subscript_expression,
      $._identifier,
      alias($._reserved_identifier, $.identifier),
      $._destructuring_pattern,
    ),

    assignment_expression: $ => prec.right('assign', seq(
      // `f() = 1` is a runtime ReferenceError, not a syntax error, in web-compatible JS (ECMA-262 §8.6.4, annex B.3.9).
      field('left', choice($.parenthesized_expression, $._lhs_expression, $.call_expression)),
      '=',
      field('right', $.expression),
    )),

    _augmented_assignment_lhs: $ => choice(
      $.member_expression,
      $.subscript_expression,
      alias($._reserved_identifier, $.identifier),
      $.identifier,
      $.parenthesized_expression,
    ),

    augmented_assignment_expression: $ => prec.right('assign', choice(
      seq(
        field('left', $._augmented_assignment_lhs),
        field('operator', choice('+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=', '>>=', '>>>=',
          '<<=', '**=', '&&=', '||=', '??=')),
        field('right', $.expression),
      ),
      // Annex B.3.9 allows a call expression only for the arithmetic operators, not the logical ones.
      seq(
        field('left', $.call_expression),
        field('operator', choice('+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=', '>>=', '>>>=', '<<=', '**=')),
        field('right', $.expression),
      ),
    )),

    _initializer: $ => seq(
      '=',
      field('value', $.expression),
    ),

    _destructuring_pattern: $ => choice(
      $.object_pattern,
      $.array_pattern,
    ),

    spread_element: $ => seq('...', $.expression),

    ternary_expression: $ => prec.right('ternary', seq(
      field('condition', $.expression),
      alias($._ternary_qmark, '?'),
      field('consequence', $.expression),
      ':',
      field('alternative', $.expression),
    )),

    binary_expression: $ => choice(
      ...[
        [['&&'], 'logical_and'],
        [['||'], 'logical_or'],
        [['>>', '>>>', '<<'], 'binary_shift'],
        [['&'], 'bitwise_and'],
        [['^'], 'bitwise_xor'],
        [['|'], 'bitwise_or'],
        [['+', '-'], 'binary_plus'],
        [['*', '/', '%'], 'binary_times'],
        [['**'], 'binary_exp', 'right'],
        [['<', '<='], 'binary_relation'],
        [['==', '===', '!=', '!=='], 'binary_equality'],
        [['>=', '>'], 'binary_relation'],
        [['??'], 'ternary'],
        [['instanceof', 'in'], 'binary_relation'],
      ].flatMap(([operators, precedence, associativity]) => operators.map(operator =>
        (associativity === 'right' ? prec.right : prec.left)(precedence, seq(
          field('left', operator === 'in' ? choice($.expression, $.private_property_identifier) : $.expression),
          field('operator', operator),
          field('right', $.expression),
        )),
      )),
    ),

    unary_expression: $ => prec.left('unary_void', seq(
      field('operator', choice('!', '~', '-', '+', 'typeof', 'void', 'delete')),
      field('argument', $.expression),
    )),

    update_expression: $ => prec.left(choice(
      seq(
        field('argument', choice($.expression, $.primary_expression)),
        field('operator', choice('++', '--')),
        optional($._postfix_update_end),
      ),
      seq(
        field('operator', choice('++', '--')),
        field('argument', $.expression),
      ),
    )),

    sequence_expression: $ => prec.right(commaSep1($.expression)),

    //
    // Primitives
    //

    string: $ => choice(
      seq(
        '"',
        repeat(choice(
          alias($.unescaped_double_string_fragment, $.string_fragment),
          $.escape_sequence,
          alias($._nul_escape_sequence, $.escape_sequence),
        )),
        // Immediate: a line terminator before the closing quote is not white space but an unterminated string.
        token.immediate('"'),
      ),
      seq(
        '\'',
        repeat(choice(
          alias($.unescaped_single_string_fragment, $.string_fragment),
          $.escape_sequence,
          alias($._nul_escape_sequence, $.escape_sequence),
        )),
        token.immediate('\''),
      ),
    ),

    // Workaround to https://github.com/tree-sitter/tree-sitter/issues/1156
    // We give names to the token() constructs containing a regexp
    // so as to obtain a node in the CST.
    //
    unescaped_double_string_fragment: _ => token.immediate(prec(1, /([^"\\\r\n\x00]|\x00+)+/)),

    // same here
    unescaped_single_string_fragment: _ => token.immediate(prec(1, /([^'\\\r\n\x00]|\x00+)+/)),

    escape_sequence: _ => token.immediate(seq(
      '\\',
      choice(
        /[^xu0-7]/,
        /[0-7]{1,3}/,
        /x[0-9a-fA-F]{2}/,
        /u[0-9a-fA-F]{4}/,
        /u\{[0-9a-fA-F]+\}/,
        /[\r?][\n\u2028\u2029]/,
      ),
    )),

    // `\` and U+0000: a branch of escape_sequence would merge with `[^xu0-7]` and lose the NUL, so it is a token of its
    // own, aliased to escape_sequence where it is used.
    _nul_escape_sequence: _ => token.immediate(seq('\\', /\x00/)),

    // http://stackoverflow.com/questions/13014947/regex-to-match-a-c-style-multiline-comment/36328890#36328890
    comment: _ => token(choice(
      seq('//', /([^\r\n\u2028\u2029\x00]|\x00+)*/),
      seq(
        '/*',
        /([^*\x00]|\x00+)*\*+(([^/*\x00]|\x00+)([^*\x00]|\x00+)*\*+)*/,
        '/',
      ),
    )),

    template_string: $ => seq(
      '`',
      repeat(choice(
        alias($._template_chars, $.string_fragment),
        $.escape_sequence,
        alias($._nul_escape_sequence, $.escape_sequence),
        $.template_substitution,
      )),
      '`',
    ),

    // A tagged template may hold escapes that are not valid in an untagged one (the cooked value is undefined).
    _tagged_template_string: $ => seq(
      '`',
      repeat(choice(
        alias($._template_chars, $.string_fragment),
        $.escape_sequence,
        alias($._nul_escape_sequence, $.escape_sequence),
        alias($._invalid_escape_sequence, $.escape_sequence),
        $.template_substitution,
      )),
      '`',
    ),

    _invalid_escape_sequence: _ => token.immediate(seq(
      '\\',
      choice(
        /x[0-9a-fA-F]?/,
        /u(\{[0-9a-fA-F]*|[0-9a-fA-F]{0,3})/,
      ),
    )),

    template_substitution: $ => seq(
      '${',
      $._expressions,
      '}',
    ),

    regex: $ => seq(
      '/',
      field('pattern', $.regex_pattern),
      token.immediate(prec(1, '/')),
      optional(field('flags', $.regex_flags)),
    ),

    regex_pattern: _ => token.immediate(prec(-1,
      repeat1(choice(
        seq(
          '[',
          repeat(choice(
            seq('\\', /([^\n\r\u2028\u2029\x00]|\x00+)/), // escaped character
            /[^\]\n\r\u2028\u2029\\\x00]/, // any character besides ']', '\' or a line terminator
            /\x00+/,
          )),
          ']',
        ), // square-bracket-delimited character class
        seq('\\', /([^\n\r\u2028\u2029\x00]|\x00+)/), // escaped character
        /[^/\\\[\n\r\u2028\u2029\x00]/, // any character besides '[', '\', '/' or a line terminator
        /\x00+/,
      )),
    )),

    regex_flags: _ => token.immediate(/[a-z]+/),

    number: _ => {
      const hexLiteral = seq(
        choice('0x', '0X'),
        /[\da-fA-F](_?[\da-fA-F])*/,
      );

      const decimalDigits = /\d(_?\d)*/;
      const signedInteger = seq(optional(choice('-', '+')), decimalDigits);
      const exponentPart = seq(choice('e', 'E'), signedInteger);

      const binaryLiteral = seq(choice('0b', '0B'), /[0-1](_?[0-1])*/);

      const octalLiteral = seq(choice('0o', '0O'), /[0-7](_?[0-7])*/);

      const bigintLiteral = seq(choice(hexLiteral, binaryLiteral, octalLiteral, decimalDigits), 'n');

      const decimalIntegerLiteral = choice(
        '0',
        seq(optional('0'), /[1-9]/, optional(seq(optional('_'), decimalDigits))),
      );

      const decimalLiteral = choice(
        seq(decimalIntegerLiteral, '.', optional(decimalDigits), optional(exponentPart)),
        seq('.', decimalDigits, optional(exponentPart)),
        seq(decimalIntegerLiteral, exponentPart),
        decimalDigits,
      );

      return token(choice(
        hexLiteral,
        decimalLiteral,
        binaryLiteral,
        octalLiteral,
        bigintLiteral,
      ));
    },

    // 'undefined' is syntactically a regular identifier in JavaScript.
    // However, its main use is as the read-only global variable whose
    // value is [undefined], for which there's no literal representation
    // unlike 'null'. We gave it its own rule so it's easy to
    // highlight in text editors and other applications.
    _identifier: $ => choice(
      $.undefined,
      $.identifier,
    ),

    identifier: _ => {
      const alpha = /[^\x00-\x1F\s\p{Zs}0-9:;`"'@#.,|^&<=>+\-*/\\%?!~()\[\]{}\uFEFF\u2060\u200B\u2028\u2029]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/;

      const alphanumeric = /[^\x00-\x1F\s\p{Zs}:;`"'@#.,|^&<=>+\-*/\\%?!~()\[\]{}\uFEFF\u2060\u200B\u2028\u2029]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/;
      return token(seq(alpha, repeat(alphanumeric)));
    },

    private_property_identifier: _ => {
      const alpha = /[^\x00-\x1F\s\p{Zs}0-9:;`"'@#.,|^&<=>+\-*/\\%?!~()\[\]{}\uFEFF\u2060\u200B\u2028\u2029]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/;

      const alphanumeric = /[^\x00-\x1F\s\p{Zs}:;`"'@#.,|^&<=>+\-*/\\%?!~()\[\]{}\uFEFF\u2060\u200B\u2028\u2029]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/;
      return token(seq('#', alpha, repeat(alphanumeric)));
    },

    meta_property: _ => choice(seq('new', '.', 'target'), seq('import', '.', 'meta')),

    this: _ => 'this',
    super: _ => 'super',
    true: _ => 'true',
    false: _ => 'false',
    null: _ => 'null',
    undefined: _ => 'undefined',

    //
    // Expression components
    //

    arguments: $ => seq(
      '(',
      commaSep(optional(choice($.expression, $.spread_element))),
      ')',
    ),

    decorator: $ => seq(
      '@',
      choice(
        $.identifier,
        $.parenthesized_expression,
        alias($.decorator_member_expression, $.member_expression),
        alias($.decorator_call_expression, $.call_expression),
      ),
    ),

    decorator_member_expression: $ => prec('member', seq(
      field('object', choice(
        $.identifier,
        alias($.decorator_member_expression, $.member_expression),
      )),
      '.',
      field('property', alias($.identifier, $.property_identifier)),
    )),

    decorator_call_expression: $ => prec('call', seq(
      field('function', choice(
        $.identifier,
        alias($.decorator_member_expression, $.member_expression),
      )),
      field('arguments', $.arguments),
    )),

    class_body: $ => seq(
      '{',
      repeat(choice(
        seq(field('member', $.method_definition), optional(';')),
        seq(field('member', $.field_definition), $._semicolon),
        field('member', $.class_static_block),
        ';',
      )),
      '}',
    ),

    field_definition: $ => seq(
      repeat(field('decorator', $.decorator)),
      optional(choice('static', alias($._static_before_get_field, 'static'))),
      field('property', $._property_name),
      optional(choice($._field_initializer, $._binding_end)),
    ),

    _field_initializer: $ => seq(
      '=',
      $._enter_plain_expression,
      field('value', $.expression),
      $._leave_concise_body,
      optional($._binding_end),
    ),

    formal_parameters: $ => seq(
      '(',
      optional($._parameter_list),
      ')',
    ),

    _parameter_list: $ => seq(
      commaSep1($._formal_parameter),
      optional(','),
    ),

    class_static_block: $ => seq(
      'static',
      optional($._automatic_semicolon),
      $._enter_static_block,
      field('body', $.statement_block),
      $._leave_context,
    ),

    // This negative dynamic precedence ensures that during error recovery,
    // unfinished constructs are generally treated as literal expressions,
    // not patterns.
    pattern: $ => prec.dynamic(-1, choice(
      $._lhs_expression,
      $.rest_pattern,
    )),

    rest_pattern: $ => prec.right(seq(
      '...',
      $._lhs_expression,
    )),

    method_definition: $ => seq(
      repeat(field('decorator', $.decorator)),
      optional(choice(
        'static',
        alias($._static_before_get_field, 'static'),
        alias(token(seq('static', /\s+/, 'get', /\s*\n/)), 'static get'),
      )),
      choice(
        seq($._ordinary_method_name, field('parameters', alias($._ordinary_method_parameters, $.formal_parameters))),
        seq(
          $._nonordinary_method_head,
          field('parameters', $.formal_parameters),
        ),
      ),
      field('body', $.statement_block),
      $._leave_context,
    ),

    _nonordinary_method_head: $ => choice(
      seq('async', optional($._restricted_keyword), optional(choice('get', 'set')), field('name', $._property_name), $._enter_await),
      seq(optional($._generator_method_continues), '*', field('name', $._property_name), $._enter_yield),
      seq('async', optional($._restricted_keyword), optional($._generator_method_continues), '*', field('name', $._property_name), $._enter_both),
    ),

    // Reduce the method head before '(' so a block call can still take its own parse branch.
    _ordinary_method_name: $ => seq(
      optional(choice('get', 'set')),
      field('name', $._property_name),
    ),

    _ordinary_method_parameters: $ => seq(
      '(',
      $._enter_plain_expression,
      optional($._parameter_list),
      ')',
    ),

    pair: $ => seq(
      field('key', $._property_name),
      ':',
      field('value', $.expression),
    ),

    pair_pattern: $ => seq(
      field('key', $._property_name),
      ':',
      field('value', choice($.pattern, $.assignment_pattern)),
    ),

    _property_name: $ => seq(optional($._keyword_continues), reserved('properties', choice(
      alias(
        choice($.identifier, $._reserved_identifier),
        $.property_identifier,
      ),
      $.private_property_identifier,
      $.string,
      $.number,
      $.computed_property_name,
    ))),

    computed_property_name: $ => seq(
      '[',
      $.expression,
      ']',
    ),

    _reserved_identifier: _ => choice(...CONTEXTUAL_KEYWORDS),

    // `this`, `super`, `true`, `false` and `null` are named token rules: listing their strings here would turn
    // each into a non-terminal with an anonymous child, so the rules themselves are used instead.
    _keyword_identifier: $ => choice(
      ...RESERVED_WORDS.filter(word => !['this', 'super', 'true', 'false', 'null'].includes(word)),
      $.this, $.super, $.true, $.false, $.null,
      ...CONTEXTUAL_KEYWORDS,
    ),

    _semicolon: $ => choice($._automatic_semicolon, $._await_using_asi, ';'),
  },
});

/**
 * Creates a using declaration ending with the given semicolon rule
 *
 * @param {GrammarSymbols<string>} $
 * @param {RuleOrLiteral} semicolon
 *
 * @returns {ChoiceRule}
 */
function usingDeclaration($, semicolon) {
  const kind = field('kind', choice('using', seq($._await_keyword, $._await_using, 'using')));
  return choice(
    seq(kind, commaSep1($._using_declarator), semicolon),
    // TypeScript reads `using as …` and `using satisfies …` as declarations; the static precedence keeps the
    // expression reading (`using as T`) from taking these names at the start of a statement.
    prec(1, seq(
      kind,
      alias($._using_keyword_declarator, $.variable_declarator),
      repeat(seq(',', $._using_declarator)),
      semicolon,
    )),
  );
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}
