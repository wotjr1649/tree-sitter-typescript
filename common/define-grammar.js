const JavaScript = require('../third_party/tree-sitter-javascript/grammar');

const callSignature = ($, parameters) => seq(
  field('type_parameters', optional($.type_parameters)),
  field('parameters', parameters),
  field('return_type', optional(
    choice($.type_annotation, $.asserts_annotation, $.type_predicate_annotation),
  )),
);

module.exports = function defineGrammar(dialect) {
  return grammar(JavaScript, {
    name: dialect,

    externals: ($, previous) => previous.concat([
      $._function_signature_automatic_semicolon,
      $.__error_recovery,
      $._comparison_gt,
      $._leave_signature,
      $._lexical_declaration_binding,
    ]),

    supertypes: ($, previous) => previous.concat([
      $.type,
      $.primary_type,
    ]),

    precedences: ($, previous) => previous.concat([
      [
        'new',
        'call',
        'typed_call',
        'instantiation',
        'unary',
        'binary',
        $.arrow_function,
      ],
      [
        'extends',
        'instantiation',
      ],
      [
        $.intersection_type,
        $.union_type,
        $.conditional_type,
        $.function_type,
        'binary',
        $.type_predicate,
        $.readonly_type,
      ],
      [$.mapped_type_clause, $.primary_expression],
      [$.accessibility_modifier, $.primary_expression],
      ['unary', 'unary_void', $.expression],
      [$.extends_clause, $.primary_expression],
      ['unary', 'assign'],
      ['declaration', $.expression],
      [$.predefined_type, $.unary_expression],
      [$.type, $.flow_maybe_type],
      [$.tuple_type, $.array_type, $.pattern, $.type],
      [$.readonly_type, $.pattern],
      [$.readonly_type, $.primary_expression],
      [$.type_query, $.subscript_expression, $.expression],
      [$.type_query, $._type_query_subscript_expression],
      [$.nested_type_identifier, $.generic_type, $.primary_type, $.lookup_type, $.index_type_query, $.type],
      [$.as_expression, $.satisfies_expression, $.primary_type],
      [$._type_query_member_expression, $.member_expression],
      [$.member_expression, $._type_query_import_member_expression_in_type_annotation],
      [$.member_expression, $._type_query_other_member_expression_in_type_annotation],
      [$._type_query_member_expression, $.primary_expression],
      [$._type_query_subscript_expression, $.subscript_expression],
      [$._type_query_subscript_expression, $.primary_expression],
      [$._type_query_call_expression, $.primary_expression],
      [$._type_query_instantiation_expression, $.primary_expression],
      [$.type_query, $.primary_expression],
      [$.override_modifier, $.primary_expression],
      [$.decorator_call_expression, $.decorator],
      [$.literal_type, $.pattern],
      [$.predefined_type, $.pattern],
      [$.call_expression, $._type_query_import_call_expression_in_type_annotation],
      [$.call_expression, $._type_query_member_call_expression_in_type_annotation],
      [$.new_expression, $.primary_expression],
      [$.meta_property, $.primary_expression],
      [$.construct_signature, $._property_name],
    ]),

    conflicts: ($, previous) => previous.filter((rules) =>
      rules.map((rule) => rule.name).join(' ') !== 'primary_expression method_definition',
    ).concat([
      // `f<typeof import('m')>()`: with the call_expression ordered above it in `precedences`, the type query lost
      // to the call and the type arguments were read as a binary `<` and `>`.
      [$.call_expression, $._type_query_call_expression],
      [$.primary_expression, $._type_query_import_arguments],
      [$.primary_expression, $._ts_nonordinary_method_head],
      [$.primary_expression, $._ts_method_signature],
      [$._ordinary_method_name, $.public_field_definition],
      [$._ordinary_method_name, $.property_signature],
      // Keep both the type arguments and the relational operator interpretations of '<'.
      [$.expression, $.call_expression, $._typed_template_call, $.instantiation_expression],
      [$.expression, $.call_expression, $.await_expression, $._typed_template_call, $.instantiation_expression],

      // This appears to be necessary to parse a parenthesized class expression
      [$.class],

      [$.nested_identifier, $.nested_type_identifier, $.primary_expression],
      [$.nested_identifier, $.nested_type_identifier],

      // The arrow function's own signature (see arrow_function) takes over these conflicts from _call_signature.
      [$._arrow_call_signature, $.function_type],
      [$._arrow_call_signature, $.constructor_type],
      ...(dialect === 'typescript' ? [
        [$.type_parameters, $._nonempty_type_parameters],
      ] : []),

      [$.primary_expression, $._parameter_name],
      [$.primary_expression, $._parameter_name, $.primary_type],
      [$.primary_expression, $.literal_type],
      [$.primary_expression, $.literal_type, $.rest_pattern],
      [$.primary_expression, $.predefined_type, $.rest_pattern],
      [$.primary_expression, $.primary_type],
      [$.primary_expression, $.generic_type],
      [$.primary_expression, $.predefined_type],
      [$.primary_expression, $.pattern, $.primary_type],
      [$._parameter_name, $.primary_type],
      [$.pattern, $.primary_type],

      [$.optional_tuple_parameter, $.primary_type],
      // `symbol?` can be an optional type or the start of an optional tuple label.
      [$.optional_tuple_parameter, $.predefined_type],
      [$.rest_pattern, $.primary_type, $.primary_expression],

      [$.object, $.object_type],
      [$.object, $.object_pattern, $.object_type],
      [$.object, $.object_pattern, $._property_name],
      [$.object_pattern, $.object_type],
      [$.object_pattern, $.object_type],

      [$.array, $.tuple_type],
      [$.array, $.array_pattern, $.tuple_type],
      [$.array_pattern, $.tuple_type],

      [$.template_literal_type, $.template_string],
    ]).concat(
      dialect === 'typescript' ? [
        [$.primary_type, $.type_parameter],
      ] : [
        [$.await_expression, $._property_name],
        [$.expression, $.call_expression, $.instantiation_expression],
        [$.expression, $.call_expression, $.await_expression, $.instantiation_expression],
        [$.jsx_opening_element, $._arrow_type_parameter],
        [$.jsx_opening_element, $.type_parameter, $._arrow_type_parameter],
        [$.type_parameter, $._arrow_type_parameter],
        // Keep JSX and type parameter branches until the tag or arrow resolves the ambiguity.
        [$.jsx_opening_element, $.type_parameter],
        [$.primary_expression, $.index_signature],
        [$.primary_expression, $._ts_method_signature, $.property_signature, $.index_signature],
        [$.primary_expression, $._ts_method_signature, $.property_signature],
        [$.jsx_namespace_name, $.literal_type],
        [$.jsx_namespace_name, $.predefined_type],
        [$.jsx_namespace_name, $.type_query],
        [$.jsx_attribute, $.constraint],
        [$.jsx_attribute, $.type_parameter],
        [$.jsx_attribute, $._arrow_type_parameter],
        [$.jsx_attribute, $.type_parameter, $._arrow_type_parameter],
        [$.jsx_namespace_name, $.primary_type],
      ],
    ),

    inline: ($, previous) => previous
      .filter((rule) => ![
        '_formal_parameter',
        '_call_signature',
      ].includes(rule.name))
      .concat([
        $._type_identifier,
        $._jsx_start_opening_element,
      ]),

    rules: {
      public_field_definition: $ => seq(
        repeat(field('decorator', $.decorator)),
        optional(choice(
          seq('declare', optional($.accessibility_modifier)),
          seq($.accessibility_modifier, optional('declare')),
        )),
        choice(
          seq(
            optional(choice('static', alias($._static_before_get_field, 'static'))),
            optional($.override_modifier),
            optional('readonly'),
          ),
          seq(optional('abstract'), optional('readonly')),
          seq(optional('readonly'), optional('abstract')),
        ),
        // `accessor` is a modifier that COMPOSES with the ones above, not a fourth
        // alternative to them. As an arm of that choice it was mutually exclusive with
        // `static`, `override`, `abstract` and `readonly`, so `static accessor x = 1`
        // and `abstract accessor x: number` were rejected outright. Accessibility
        // modifiers and decorators are matched in earlier clauses, which is why
        // `public accessor` and `@dec accessor` were the only two that ever worked.
        //
        // `readonly accessor` is over-accepted here: TypeScript rejects it (TS1243).
        // Excluding it would need the readonly-bearing arms split, and a grammar that
        // accepts a little more than the type checker is harmless.
        optional('accessor'),
        field('name', $._property_name),
        optional(choice('?', '!')),
        field('type', optional($.type_annotation)),
        optional(choice($._field_initializer, $._binding_end)),
      ),

      // override original catch_clause, add optional type annotation
      catch_clause: $ => seq(
        'catch',
        optional(
          seq(
            '(',
            field(
              'parameter',
              choice($.identifier, $._destructuring_pattern),
            ),
            optional(
              // only types that resolve to 'any' or 'unknown' are supported
              // by the language but it's simpler to accept any type here.
              field('type', $.type_annotation),
            ),
            ')',
          ),
        ),
        field('body', $.statement_block),
      ),

      call_expression: $ => choice(
        prec.dynamic(2, prec('call', seq(
          field('function', choice($.expression, $._postfix_expression, $.import)),
          field('arguments', $.arguments),
        ))),
        // Prefer attaching type arguments to an await operand when both parses succeed.
        prec.dynamic(2, prec('typed_call', seq(
          field('function', choice(prec.dynamic(1, $._postfix_expression), $.import)),
          field('type_arguments', $.type_arguments),
          field('arguments', $.arguments),
        ))),
        prec('template_call', seq(
          field('function', choice($.primary_expression, $.new_expression)),
          field('arguments', alias($._tagged_template_string, $.template_string)),
        )),
        $._typed_template_call,
        prec('member', seq(
          field('function', $.primary_expression),
          '?.',
          field('type_arguments', optional($.type_arguments)),
          field('arguments', $.arguments),
        )),
      ),

      // A tagged template with type arguments, `sql<{ a: string }>`x``. The callee
      // is a primary_expression, as for the template above, so a prefix, binary or
      // update operator in front binds to the whole tagged template, as in tsc
      // (`await sql<T>`x`` is await (sql<T>`x`)). It conflicts with reducing the
      // callee to an `expression` for a call or an instantiation. Dynamic
      // precedence settles the readings that both parse: the template wins over
      // the comparison `(a < b) > template`, and a plain call outranks the
      // template reading so `c ? f<R<S>>(d) : e` still reads as a call.
      _typed_template_call: $ => prec.dynamic(1, seq(
        field('function', choice($.primary_expression, $.new_expression)),
        field('type_arguments', $.type_arguments),
        field('arguments', alias($._tagged_template_string, $.template_string)),
      )),

      new_expression: $ => prec.right('new', seq(
        'new',
        field('constructor', $.primary_expression),
        field('type_arguments', optional($.type_arguments)),
        field('arguments', optional($.arguments)),
      )),

      assignment_expression: $ => prec.right('assign', seq(
        field('left', choice($.parenthesized_expression, $._lhs_expression, $.call_expression)),
        '=',
        field('right', $.expression),
      )),

      _augmented_assignment_lhs: ($, previous) => choice(previous, $.non_null_expression),

      _lhs_expression: ($, previous) => choice(previous, $.non_null_expression),

      primary_expression: ($, previous) => choice(
        previous,
        $.non_null_expression,
      ),

      // Prefer await in an active context even when an ordinary call carries dynamic precedence.
      await_expression: (_, previous) => prec.dynamic(3, previous),

      _await_operand: ($, previous) => choice(
        ...previous.members.filter((member) => dialect === 'tsx' || member.name !== '_jsx_element'),
        ...(dialect === 'typescript' ? [$.type_assertion] : []),
        // Outrank the inherited await priority when both instantiation parses succeed.
        prec.dynamic(2, $.instantiation_expression),
      ),

      _postfix_expression: ($, previous) => dialect === 'typescript' ?
        choice($.primary_expression, $.new_expression) :
        previous,

      // If the dialect is regular typescript, we exclude JSX expressions and
      // include type assertions. If the dialect is TSX, we do the opposite.
      expression: ($, previous) => {
        const choices = [
          $.as_expression,
          $.satisfies_expression,
          $.instantiation_expression,
          $.internal_module,
        ];

        if (dialect === 'typescript') {
          choices.push($.type_assertion);
          choices.push(...previous.members.filter((member) =>
            member.name !== '_jsx_element',
          ));
        } else if (dialect === 'tsx') {
          choices.push(...previous.members);
        } else {
          throw new Error(`Unknown dialect ${dialect}`);
        }

        return choice(...choices);
      },

      _jsx_start_opening_element: $ => seq(
        '<',
        optional(
          seq(
            choice(
              field('name', choice(
                alias($.jsx_identifier, $.identifier),
                $.jsx_namespace_name,
              )),
              seq(
                field('name', choice(
                  $.identifier,
                  alias(choice($._jsx_keyword_identifier, $.this), $.identifier),
                  // Keep ordinary members separate from JSX-only keyword, this and hyphenated heads.
                  alias($.nested_identifier, $.member_expression),
                  alias($._jsx_keyword_member_expression, $.member_expression),
                )),
                field('type_arguments', optional($.type_arguments)),
              ),
            ),
            repeat(field('attribute', $._jsx_attribute)),
          ),
        ),
      ),

      // This rule is only referenced by expression when the dialect is 'tsx'
      jsx_opening_element: $ => prec.dynamic(-1, seq(
        $._jsx_start_opening_element,
        '>',
      )),

      // tsx only. See jsx_opening_element.
      jsx_self_closing_element: $ => prec.dynamic(-1, seq(
        $._jsx_start_opening_element,
        '/>',
      )),

      _module_export_name: $ => reserved('properties', choice(
        $.identifier,
        $.string,
        alias('default', $.identifier),
      )),

      export_specifier: (_, previous) => seq(
        optional(choice('type', 'typeof')),
        previous,
      ),

      _import_identifier: $ => choice($.identifier, alias('type', $.identifier)),

      import_specifier: $ => seq(
        optional(choice('type', 'typeof')),
        choice(
          field('name', $._import_identifier),
          seq(
            field('name', choice($._module_export_name, alias('type', $.identifier))),
            'as',
            field('alias', $._import_identifier),
          ),
        ),
      ),

      import_attribute: $ => seq(choice('with', 'assert'), $.object),

      import_clause: $ => choice(
        $.namespace_import,
        $.named_imports,
        seq(
          $._import_identifier,
          optional(seq(
            ',',
            choice(
              $.namespace_import,
              $.named_imports,
            ),
          )),
        ),
      ),

      import_statement: $ => seq(
        'import',
        optional(choice('type', 'typeof')),
        choice(
          seq($.import_clause, $._from_clause),
          $.import_require_clause,
          field('source', $.string),
        ),
        optional($.import_attribute),
        $._semicolon,
      ),

      export_statement: ($, previous) => choice(
        previous,
        seq(
          'export',
          'type',
          choice(
            seq('*', $._from_clause),
            seq($.namespace_export, $._from_clause),
            seq($.export_clause, optional($._from_clause)),
          ),
          $._semicolon,
        ),
        seq('export', '=', $.expression, $._semicolon),
        seq('export', 'as', 'namespace', $.identifier, $._semicolon),
      ),

      namespace_export: $ => seq(
        '*', 'as', reserved('properties', choice($.identifier, $.string, alias('default', $.identifier))),
      ),

      non_null_expression: $ => prec.left('unary', seq(
        choice($._postfix_expression, $.update_expression), '!',
      )),

      // The scanner never produces `_lexical_declaration_binding`; its validity tells it that `let` may go on
      // with a binding on the next line (`let⏎x = 1`), where `let` alone could also end a statement.
      lexical_declaration: $ => seq(
        field('kind', choice('let', 'const')),
        optional($._lexical_declaration_binding),
        commaSep1($.variable_declarator),
        $._semicolon,
      ),

      _using_declarator: $ => $.variable_declarator,

      // TS allows a type annotation after the keyword-named declarator: `using as: D = f();`.
      _using_keyword_declarator: $ => seq(
        field('name', alias(choice('as', 'satisfies'), $.identifier)),
        optional(choice(
          $._initializer,
          $._declaration_end,
          seq(field('type', $.type_annotation), optional($._initializer)),
        )),
      ),

      variable_declarator: $ => choice(
        seq(
          field('name', choice($.identifier, $._destructuring_pattern)),
          field('type', optional($.type_annotation)),
          optional(choice($._initializer, $._declaration_end)),
        ),
        prec('declaration', seq(
          field('name', $.identifier),
          '!',
          field('type', $.type_annotation),
        )),
      ),

      method_signature: $ => seq(
        $._ts_method_signature,
        $._leave_signature,
      ),

      abstract_method_signature: $ => seq(
        optional($.accessibility_modifier),
        'abstract',
        optional($.override_modifier),
        optional(choice('get', 'set', seq(optional($._generator_method_continues), '*'))),
        field('name', $._property_name),
        optional('?'),
        $._call_signature,
      ),

      parenthesized_expression: $ => seq(
        '(',
        choice(
          seq($.expression, field('type', optional($.type_annotation))),
          $.sequence_expression,
        ),
        ')',
      ),

      _formal_parameter: $ => choice(
        $.required_parameter,
        $.optional_parameter,
      ),

      function_signature: $ => seq(
        choice(
          seq('function', field('name', $.identifier), $._enter_plain),
          seq('async', 'function', field('name', $.identifier), $._enter_await),
        ),
        $._call_signature,
        $._leave_signature,
        choice($._semicolon, $._function_signature_automatic_semicolon),
      ),

      decorator: $ => seq(
        '@',
        choice(
          $.identifier,
          alias($.decorator_member_expression, $.member_expression),
          alias($.decorator_call_expression, $.call_expression),
          alias($.decorator_parenthesized_expression, $.parenthesized_expression),
        ),
      ),

      decorator_member_expression: $ => prec('member', seq(
        field('object', choice(
          $.identifier,
          alias($.decorator_member_expression, $.member_expression),
        )),
        '.',
        field('property', reserved('properties', alias($.identifier, $.property_identifier))),
      )),

      decorator_call_expression: $ => prec('call', seq(
        field('function', choice(
          $.identifier,
          alias($.decorator_member_expression, $.member_expression),
        )),
        optional(field('type_arguments', $.type_arguments)),
        field('arguments', $.arguments),
      )),

      // Keep the parenthesized_expression node without the ordinary rule's type annotation.
      decorator_parenthesized_expression: $ => seq(
        '(',
        $.expression,
        ')',
      ),

      class_body: $ => seq(
        '{',
        repeat(choice(
          seq(
            repeat(field('decorator', $.decorator)),
            $.method_definition,
            optional($._semicolon),
          ),
          // As it happens for functions, the semicolon insertion should not
          // happen if a block follows the closing paren, because then it's a
          // *definition*, not a declaration. Example:
          //     public foo()
          //     { <--- this brace made the method signature become a definition
          //     }
          // The same rule applies for functions and that's why we use
          // "_function_signature_automatic_semicolon".
          seq($.method_signature, choice($._function_signature_automatic_semicolon, ',')),
          $.class_static_block,
          seq(
            choice(
              $.abstract_method_signature,
              $.index_signature,
              $.method_signature,
              $.public_field_definition,
            ),
            choice($._semicolon, ','),
          ),
          ';',
        )),
        '}',
      ),

      method_definition: $ => prec.left(seq(
        $._ts_method_signature,
        field('body', $.statement_block),
        $._leave_context,
      )),

      _ts_method_signature: $ => seq(
        optional($.accessibility_modifier),
        optional(choice('static', alias($._static_before_get_field, 'static'))),
        optional($.override_modifier),
        optional('readonly'),
        choice(
          seq($._ordinary_method_name, optional('?'), $._ordinary_method_call_signature),
          seq($._ts_nonordinary_method_head, $._call_signature),
        ),
      ),

      _ts_nonordinary_method_head: $ => choice(
        seq('async', optional($._restricted_keyword), optional(choice('get', 'set')), field('name', $._property_name), optional('?'), $._enter_await),
        seq(optional($._generator_method_continues), '*', field('name', $._property_name), optional('?'), $._enter_yield),
        seq('async', optional($._restricted_keyword), optional($._generator_method_continues), '*', field('name', $._property_name), optional('?'), $._enter_both),
      ),

      declaration: ($, previous) => choice(
        previous,
        $.function_signature,
        $.abstract_class_declaration,
        $.module,
        prec('declaration', $.internal_module),
        $.type_alias_declaration,
        $.enum_declaration,
        $.interface_declaration,
        $.import_alias,
        $.ambient_declaration,
      ),

      type_assertion: $ => prec.left('unary', seq(
        $.type_arguments,
        $.expression,
      )),

      as_expression: $ => prec.left('binary', seq(
        $.expression,
        'as',
        choice('const', $.type),
      )),

      satisfies_expression: $ => prec.left('binary', seq(
        $.expression,
        'satisfies',
        $.type,
      )),

      binary_expression: ($, previous) => choice(
        previous,
        // Prefer the comparison if > can introduce a signed operand on the same line.
        prec.dynamic(4, prec.left('binary_relation', seq(
          field('left', $.expression),
          field('operator', alias($._comparison_gt, '>')),
          field('right', $.expression),
        ))),
      ),

      // A comparison before type arguments stays outside the postfix expression.
      instantiation_expression: $ => prec('instantiation', seq(
        $._postfix_expression,
        field('type_arguments', $.type_arguments),
      )),

      class_heritage: $ => choice(
        seq($.extends_clause, optional($.implements_clause)),
        $.implements_clause,
      ),

      import_require_clause: $ => seq(
        $.identifier,
        '=',
        'require',
        '(',
        field('source', $.string),
        ')',
      ),

      extends_clause: $ => seq(
        'extends',
        commaSep1($._extends_clause_single),
      ),

      _extends_clause_single: $ => prec('extends', seq(
        field('value', $.expression),
        // Keep trailing type arguments on the extends clause when both parses succeed.
        field('type_arguments', optional(prec.dynamic(1, $.type_arguments))),
      )),

      implements_clause: $ => seq(
        'implements',
        commaSep1($.type),
      ),

      ambient_declaration: $ => seq(
        'declare',
        choice(
          $.declaration,
          seq('global', $.statement_block),
          seq('module', '.', alias($.identifier, $.property_identifier), ':', $.type, $._semicolon),
        ),
      ),

      class: $ => prec('literal', seq(
        repeat(field('decorator', $.decorator)),
        'class',
        field('name', optional($._type_identifier)),
        field('type_parameters', optional($.type_parameters)),
        optional($.class_heritage),
        field('body', $.class_body),
      )),

      abstract_class_declaration: $ => prec('declaration', seq(
        repeat(field('decorator', $.decorator)),
        'abstract',
        'class',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.class_heritage),
        field('body', $.class_body),
      )),

      class_declaration: $ => prec.left('declaration', seq(
        repeat(field('decorator', $.decorator)),
        'class',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.class_heritage),
        field('body', $.class_body),
        optional($._automatic_semicolon),
      )),

      module: $ => seq(
        'module',
        $._module,
      ),

      internal_module: $ => seq(
        'namespace',
        $._module,
      ),

      _module: $ => prec.right(seq(
        field('name', choice($.string, $.identifier, $.nested_identifier)),
        // On .d.ts files "declare module foo" desugars to "declare module foo {}",
        // hence why it is optional here
        field('body', optional($.statement_block)),
      )),

      import_alias: $ => seq(
        'import',
        $.identifier,
        '=',
        choice($.identifier, $.nested_identifier),
        $._semicolon,
      ),

      // Score each prefix segment so `as` and `satisfies` consume the full qualified type before reducing.
      nested_identifier: ($, previous) => prec.dynamic(1, previous),

      nested_type_identifier: $ => prec('member', seq(
        field('module', choice($.identifier, $.nested_identifier)),
        '.',
        field('name', $._type_identifier),
      )),

      interface_declaration: $ => seq(
        'interface',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.extends_type_clause),
        field('body', alias($.object_type, $.interface_body)),
      ),

      extends_type_clause: $ => seq(
        'extends',
        commaSep1(field('type', choice(
          $._type_identifier,
          $.nested_type_identifier,
          $.generic_type,
        ))),
      ),

      enum_declaration: $ => seq(
        optional('const'),
        'enum',
        field('name', $.identifier),
        field('body', $.enum_body),
      ),

      enum_body: $ => seq(
        '{',
        optional(seq(
          sepBy1(',', choice(
            field('name', $._property_name),
            $.enum_assignment,
          )),
          optional(','),
        )),
        '}',
      ),

      enum_assignment: $ => seq(
        field('name', $._property_name),
        $._initializer,
      ),

      type_alias_declaration: $ => seq(
        'type',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        '=',
        field('value', $.type),
        $._semicolon,
      ),

      accessibility_modifier: _ => choice(
        'public',
        'private',
        'protected',
      ),

      override_modifier: _ => 'override',

      required_parameter: $ => seq(
        $._parameter_name,
        field('type', optional($.type_annotation)),
        optional($._initializer),
      ),

      optional_parameter: $ => seq(
        $._parameter_name,
        '?',
        field('type', optional($.type_annotation)),
        optional($._initializer),
      ),

      _parameter_name: $ => seq(
        repeat(field('decorator', $.decorator)),
        optional($.accessibility_modifier),
        optional($.override_modifier),
        optional('readonly'),
        field('pattern', choice($.pattern, $.this)),
      ),

      omitting_type_annotation: $ => seq('-?:', $.type),
      adding_type_annotation: $ => seq('+?:', $.type),
      opting_type_annotation: $ => seq('?:', $.type),
      type_annotation: $ => seq(
        ':',
        $.type,
      ),

      // Oh boy
      // The issue is these special type queries need a lower relative precedence than the normal ones,
      // since these are used in type annotations whereas the other ones are used where `typeof` is
      // required beforehand. This allows for parsing of annotations such as
      // foo: import('x').y.z;
      // but was a nightmare to get working.
      // A member chain that is not a pure `import(...)` dot chain: it has a bare `import` or a call in it.
      _type_query_other_member_expression_in_type_annotation: $ => seq(
        field('object', choice(
          $.import,
          alias($._type_query_other_member_expression_in_type_annotation, $.member_expression),
          alias($._type_query_member_call_expression_in_type_annotation, $.call_expression),
        )),
        '.',
        field('property', choice(
          $.private_property_identifier,
          reserved('properties', alias($.identifier, $.property_identifier)),
        )),
      ),
      // A dot chain that starts at `import(...)`, with no call in between and no bare `import`: the only
      // chain that may end in type arguments (ours, on top of upstream #365).
      _type_query_import_member_expression_in_type_annotation: $ => seq(
        field('object', choice(
          alias($._type_query_import_call_expression_in_type_annotation, $.call_expression),
          alias($._type_query_import_member_expression_in_type_annotation, $.member_expression),
        )),
        '.',
        field('property', choice(
          $.private_property_identifier,
          reserved('properties', alias(choice($.identifier, $._keyword_identifier), $.property_identifier)),
        )),
      ),
      // Type arguments only on the outermost member, not on an object or callee (ours, on top of upstream #365).
      _type_query_instantiated_member_expression_in_type_annotation: $ => seq(
        $._type_query_import_member_expression_in_type_annotation,
        $.type_arguments,
      ),
      _type_query_import_call_expression_in_type_annotation: $ => seq(
        field('function', $.import),
        field('arguments', $.arguments),
      ),
      _type_query_member_call_expression_in_type_annotation: $ => seq(
        field('function', choice(
          alias($._type_query_import_member_expression_in_type_annotation, $.member_expression),
          alias($._type_query_other_member_expression_in_type_annotation, $.member_expression),
        )),
        field('arguments', $.arguments),
      ),

      asserts: $ => seq(
        'asserts',
        choice($.type_predicate, $.identifier, $.this),
      ),

      asserts_annotation: $ => seq(
        seq(':', $.asserts),
      ),

      type: $ => choice(
        $.primary_type,
        $.function_type,
        $.readonly_type,
        $.constructor_type,
        $.infer_type,
        prec(-1, alias($._type_query_other_member_expression_in_type_annotation, $.member_expression)),
        prec(-1, alias($._type_query_member_call_expression_in_type_annotation, $.call_expression)),
      ),

      tuple_parameter: $ => seq(
        field('name', choice($.identifier, alias('symbol', $.identifier), $.rest_pattern)),
        field('type', $.type_annotation),
      ),

      optional_tuple_parameter: $ => seq(
        field('name', choice($.identifier, alias('symbol', $.identifier))),
        '?',
        field('type', $.type_annotation),
      ),

      optional_type: $ => seq($.type, '?'),
      rest_type: $ => seq('...', $.type),

      _tuple_type_member: $ => choice(
        alias($.tuple_parameter, $.required_parameter),
        alias($.optional_tuple_parameter, $.optional_parameter),
        $.optional_type,
        $.rest_type,
        $.type,
      ),

      constructor_type: $ => prec.left(seq(
        optional('abstract'),
        'new',
        field('type_parameters', optional($.type_parameters)),
        field('parameters', $.formal_parameters),
        '=>',
        field('type', $.type),
      )),

      primary_type: $ => choice(
        $.parenthesized_type,
        $.predefined_type,
        $._type_identifier,
        $.nested_type_identifier,
        $.generic_type,
        $.object_type,
        $.array_type,
        $.tuple_type,
        $.flow_maybe_type,
        $.type_query,
        $.index_type_query,
        // `import(...)` types that may be followed by `[]` or an index (`import('x').Y[]`, `import('x')['k']`): a
        // member chain that starts at `import(...)` and the bare `import(...)`. They are primary types, not only
        // `type`s, because `array_type`, `lookup_type`, `keyof` and the like take a primary type. The chains with a
        // call or a bare `import` stay in `type` (below): tsc rejects `import('x').A()[]` and `import.A[]`.
        prec(-1, alias($._type_query_import_member_expression_in_type_annotation, $.member_expression)),
        prec(-1, alias($._type_query_instantiated_member_expression_in_type_annotation, $.member_expression)),
        prec(-1, alias($._type_query_import_call_expression_in_type_annotation, $.call_expression)),
        alias($.this, $.this_type),
        $.existential_type,
        $.literal_type,
        $.lookup_type,
        $.conditional_type,
        $.template_literal_type,
        $.intersection_type,
        $.union_type,
        'const',
      ),

      template_type: $ => seq('${', choice($.primary_type, $.infer_type), '}'),

      template_literal_type: $ => seq(
        '`',
        repeat(choice(
          alias($._template_chars, $.string_fragment),
          $.template_type,
        )),
        '`',
      ),

      infer_type: $ => prec.right(seq(
        'infer',
        $._type_identifier,
        optional(seq(
          'extends',
          $.type,
        )),
      )),

      conditional_type: $ => prec.right(seq(
        field('left', $.type),
        'extends',
        field('right', $.type),
        '?',
        field('consequence', $.type),
        ':',
        field('alternative', $.type),
      )),

      generic_type: $ => prec('call', seq(
        field('name', choice(
          $._type_identifier,
          $.nested_type_identifier,
        )),
        field('type_arguments', $.type_arguments),
      )),

      type_predicate: $ => seq(
        field('name', choice(
          $.identifier,
          $.this,
          // Sometimes tree-sitter contextual lexing is not good enough to know
          // that 'object' in ':object is foo' is really an identifier and not
          // a predefined_type, so we must explicitely list all possibilities.
          // TODO: should we use '_reserved_identifier'? Should all the element in
          // 'predefined_type' be added to '_reserved_identifier'?
          alias($.predefined_type, $.identifier),
        )),
        'is',
        field('type', $.type),
      ),

      type_predicate_annotation: $ => seq(
        seq(':', $.type_predicate),
      ),

      // Type query expressions are more restrictive than regular expressions
      _type_query_member_expression: $ => seq(
        field('object', choice(
          $.identifier,
          $.this,
          alias($._type_query_subscript_expression, $.subscript_expression),
          alias($._type_query_member_expression, $.member_expression),
          alias($._type_query_call_expression, $.call_expression),
        )),
        choice('.', '?.'),
        field('property', choice(
          $.private_property_identifier,
          reserved('properties', alias($.identifier, $.property_identifier)),
        )),
      ),
      _type_query_subscript_expression: $ => seq(
        field('object', choice(
          $.identifier,
          $.this,
          alias($._type_query_subscript_expression, $.subscript_expression),
          alias($._type_query_member_expression, $.member_expression),
          alias($._type_query_call_expression, $.call_expression),
        )),
        optional('?.'),
        '[', field('index', choice($.predefined_type, $.string, $.number)), ']',
      ),
      _type_query_call_expression: $ => choice(
        // `import('m')` or `import('m', { with: ... })`: the only calls tsc reads as a type (an import type takes a string
        // literal and an optional attributes object, see `_type_query_import_arguments`). Dynamic precedence 1:
        // in `f<typeof import('m')>(1, 2)` the comparison reading also holds a call_expression (`import('m')`,
        // dynamic 2 through the plain call), tying with the call reading; the type query must outrank it. Not on the
        // calls below: tsc reads `sql<A, typeof f(x)>\`t\``, `f<typeof import('m', 'n')>(1)` and `f<typeof import(g(x))>(1)`
        // as comparisons.
        prec.dynamic(1, seq(
          field('function', $.import),
          field('arguments', alias($._type_query_import_arguments, $.arguments)),
        )),
        seq(
          field('function', choice(
            $.import,
            $.identifier,
            alias($._type_query_member_expression, $.member_expression),
            alias($._type_query_subscript_expression, $.subscript_expression),
          )),
          field('arguments', $.arguments),
        ),
      ),
      // A string literal and an optional object (the import attributes), no trailing comma: tsc rejects `import('m',)` (TS1005)
      // and reads `import('m', { with: {} },)` as a comparison. Any other argument is not an import type for us either.
      // `arguments` lists `string` and `object` among its children because of this rule (a schema addition).
      _type_query_import_arguments: $ => seq('(', $.string, optional(seq(',', $.object)), ')'),
      _type_query_instantiation_expression: $ => seq(
        field('function', choice(
          $.import,
          $.identifier,
          alias($._type_query_member_expression, $.member_expression),
          alias($._type_query_subscript_expression, $.subscript_expression),
        )),
        field('type_arguments', $.type_arguments),
      ),
      type_query: $ => prec.right(seq(
        'typeof',
        choice(
          alias($._type_query_subscript_expression, $.subscript_expression),
          alias($._type_query_member_expression, $.member_expression),
          alias($._type_query_call_expression, $.call_expression),
          alias($._type_query_instantiation_expression, $.instantiation_expression),
          $.identifier,
          $.this,
        ),
      )),

      index_type_query: $ => seq(
        'keyof',
        $.primary_type,
      ),

      lookup_type: $ => seq(
        $.primary_type,
        '[',
        $.type,
        ']',
      ),

      mapped_type_clause: $ => seq(
        field('name', $._type_identifier),
        'in',
        field('type', $.type),
        optional(seq('as', field('alias', $.type))),
      ),

      literal_type: $ => choice(
        alias($._number, $.unary_expression),
        $.number,
        $.string,
        $.true,
        $.false,
        $.null,
        $.undefined,
      ),

      _number: $ => prec.left(1, seq(
        field('operator', choice('-', '+')),
        field('argument', $.number),
      )),

      existential_type: _ => '*',

      flow_maybe_type: $ => prec.right(seq('?', $.primary_type)),

      parenthesized_type: $ => seq('(', $.type, ')'),

      predefined_type: _ => choice(
        'any',
        'number',
        'boolean',
        'string',
        'symbol',
        alias(seq('unique', 'symbol'), 'unique symbol'),
        'void',
        'unknown',
        'string',
        'never',
        'object',
      ),

      type_arguments: $ => seq(
        '<',
        commaSep1($.type),
        optional(','),
        '>',
      ),

      object_type: $ => seq(
        choice('{', '{|'),
        optional(seq(
          optional(choice(',', ';')),
          sepBy1(
            choice(',', $._semicolon),
            choice(
              $.export_statement,
              $.property_signature,
              $.call_signature,
              $.construct_signature,
              $.index_signature,
              $.method_signature,
              alias($._abstract_named_method_signature, $.method_signature),
            ),
          ),
          optional(choice(',', $._semicolon)),
        )),
        choice('}', '|}'),
      ),

      call_signature: $ => $._call_signature,

      property_signature: $ => choice(
        seq(
          optional($.accessibility_modifier),
          optional('static'),
          optional($.override_modifier),
          optional('readonly'),
          field('name', $._property_name),
          optional('?'),
          field('type', optional($.type_annotation)),
        ),
        // An explicit suffix keeps ASI out of the construct signature's path.
        seq(
          field('name', alias('abstract', $.property_identifier)),
          choice(
            field('type', $.type_annotation),
            seq('?', field('type', optional($.type_annotation))),
          ),
        ),
      ),

      _abstract_named_method_signature: $ => seq(
        field('name', alias('abstract', $.property_identifier)),
        optional('?'),
        $._ordinary_method_call_signature,
        $._leave_signature,
      ),

      _call_signature: $ => callSignature($, $.formal_parameters),

      _ordinary_method_call_signature: $ => callSignature($, alias($._ordinary_method_parameters, $.formal_parameters)),

      // tsc's parser accepts an empty list (`type A<> = number;`); TS1098 is a checker error.
      type_parameters: $ => seq(
        '<', optional(seq(commaSep1($.type_parameter), optional(','))), '>',
      ),

      // A declaration can take empty type parameters, while an arrow needs at least one.
      _arrow_parameters: $ => choice(
        field('parameter', choice(alias($._reserved_identifier, $.identifier), $.identifier)),
        $._arrow_call_signature,
      ),

      _arrow_call_signature: $ => seq(
        field('type_parameters', optional(alias($._nonempty_type_parameters, $.type_parameters))),
        field('parameters', $.formal_parameters),
        field('return_type', optional(
          choice($.type_annotation, $.asserts_annotation, $.type_predicate_annotation),
        )),
      ),

      _nonempty_type_parameters: $ => seq(
        '<', commaSep1($.type_parameter), optional(','), '>',
      ),

      type_parameter: $ => seq(
        optional('const'),
        optional(choice('in', seq(optional('in'), 'out'))),
        // `out` is contextual: `type A<out> = out` names a type parameter `out` (tsc accepts it).
        field('name', choice($._type_identifier, alias('out', $.type_identifier))),
        field('constraint', optional($.constraint)),
        field('value', optional($.default_type)),
      ),

      // tsx only. tsc reads `<in` and `<out` after an expression-start `<` as a JSX tag name and rejects a
      // variance modifier on the first type parameter of an arrow function, so that one takes none; `in` and `out`
      // stay plain names and tags, as before variance annotations existed. Later parameters (`<T, in U>`) are
      // unambiguous and keep them.
      ...(dialect === 'tsx' ? {
        _arrow_call_signature: $ => seq(
          field('type_parameters', optional(alias($._arrow_type_parameters, $.type_parameters))),
          field('parameters', $.formal_parameters),
          field('return_type', optional(
            choice($.type_annotation, $.asserts_annotation, $.type_predicate_annotation),
          )),
        ),

        _arrow_type_parameters: $ => seq(
          '<',
          alias($._arrow_type_parameter, $.type_parameter),
          repeat(seq(',', $.type_parameter)),
          optional(','),
          '>',
        ),

        _arrow_type_parameter: $ => seq(
          optional('const'),
          field('name', $._type_identifier),
          field('constraint', optional($.constraint)),
          field('value', optional($.default_type)),
        ),
      } : {}),

      default_type: $ => seq(
        '=',
        $.type,
      ),

      constraint: $ => seq(
        choice('extends', ':'),
        $.type,
      ),

      construct_signature: $ => seq(
        optional('abstract'),
        'new',
        field('type_parameters', optional($.type_parameters)),
        field('parameters', $.formal_parameters),
        field('type', optional($.type_annotation)),
      ),

      index_signature: $ => seq(
        optional(
          seq(
            field('sign', optional(choice('-', '+'))),
            'readonly',
          ),
        ),
        '[',
        choice(
          seq(
            field('name', choice(
              $.identifier,
              alias($._reserved_identifier, $.identifier),
            )),
            ':',
            field('index_type', $.type),
          ),
          $.mapped_type_clause,
        ),
        ']',
        field('type', choice(
          $.type_annotation,
          $.omitting_type_annotation,
          $.adding_type_annotation,
          $.opting_type_annotation,
        )),
      ),

      array_type: $ => seq($.primary_type, '[', ']'),
      tuple_type: $ => seq(
        '[', commaSep($._tuple_type_member), optional(','), ']',
      ),
      readonly_type: $ => seq('readonly', $.type),

      union_type: $ => prec.left(seq(optional($.type), '|', $.type)),
      intersection_type: $ => prec.left(seq(optional($.type), '&', $.type)),

      function_type: $ => prec.left(seq(
        field('type_parameters', optional($.type_parameters)),
        field('parameters', $.formal_parameters),
        '=>',
        field('return_type', choice($.type, $.asserts, $.type_predicate)),
      )),

      _type_identifier: $ => alias($.identifier, $.type_identifier),

      // `export` is no longer a `_reserved_identifier` (JS v3b), and `export` starts an `export_statement` member of an
      // object type: it needs to stay a property name there (`{ export: number }`).
      _property_name: ($, previous) => choice(previous, alias('export', $.property_identifier)),

      _reserved_identifier: (_, previous) => choice(
        'declare',
        'namespace',
        'type',
        'public',
        'private',
        'protected',
        'override',
        'readonly',
        // `accessor` is contextual, not reserved: a class member may be named
        // `accessor`, and in the method form that is plain ECMAScript predating
        // TypeScript. Without this row the anonymous `accessor` modifier token wins
        // at the start of a member and the following `(`, `;`, `=` or `:` has no
        // name to attach to. This is the same mechanism `static`, `readonly`,
        // `override` and `declare` already rely on to be nameable.
        'accessor',
        'module',
        'any',
        'number',
        'boolean',
        'string',
        'symbol',
        'object',
        'new',
        'readonly',
        previous,
      ),
    },
  });
};

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return sepBy1(',', rule);
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function commaSep(rule) {
  return sepBy(',', rule);
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a separator
 *
 * @param {RuleOrLiteral} sep
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {ChoiceRule}
 */
function sepBy(sep, rule) {
  return optional(sepBy1(sep, rule));
}

/**
 * Creates a rule to match one or more of the rules separated by a separator
 *
 * @param {RuleOrLiteral} sep
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function sepBy1(sep, rule) {
  return seq(rule, repeat(seq(sep, rule)));
}
