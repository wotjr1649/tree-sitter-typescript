cmake_minimum_required(VERSION 3.13)

project(tree-sitter-typescript
        VERSION "3.1.0"
		DESCRIPTION "TypeScript and TSX grammars for tree-sitter"
        HOMEPAGE_URL "https://github.com/wotjr1649/tree-sitter-typescript"
        LANGUAGES C)

option(BUILD_SHARED_LIBS "Build using shared libraries" ON)
option(TREE_SITTER_REUSE_ALLOCATOR "Reuse the library allocator" OFF)

if(NOT DEFINED TREE_SITTER_ABI_VERSION)
    file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/ci/tree-sitter-abi.txt" TREE_SITTER_DEFAULT_ABI_VERSION)
endif()
set(TREE_SITTER_ABI_VERSION "${TREE_SITTER_DEFAULT_ABI_VERSION}" CACHE STRING "Tree-sitter ABI version")
if(NOT "${TREE_SITTER_ABI_VERSION}" MATCHES "^[0-9]+$")
    unset(TREE_SITTER_ABI_VERSION CACHE)
    message(FATAL_ERROR "TREE_SITTER_ABI_VERSION must be an integer")
endif()

find_program(TREE_SITTER_CLI tree-sitter DOC "Tree-sitter CLI")

include(GNUInstallDirs)

macro(add_parser name)
    # Use the ABI of the parser being compiled. TREE_SITTER_ABI_VERSION controls ts-generate.
    set(parser "${CMAKE_CURRENT_SOURCE_DIR}/src/parser.c")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${parser}")
    file(STRINGS "${parser}" parser_abi_define LIMIT_COUNT 1 REGEX "^#define LANGUAGE_VERSION [0-9]+$")
    if(NOT parser_abi_define MATCHES "^#define LANGUAGE_VERSION ([0-9]+)$")
        message(FATAL_ERROR "Cannot read LANGUAGE_VERSION from ${parser}")
    endif()
    set(parser_abi "${CMAKE_MATCH_1}")

    add_library(tree-sitter-${name}
                "${parser}"
                "${CMAKE_CURRENT_SOURCE_DIR}/src/scanner.c")
    target_include_directories(tree-sitter-${name} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")

    target_compile_definitions(tree-sitter-${name} PRIVATE
                               $<$<BOOL:${TREE_SITTER_REUSE_ALLOCATOR}>:TREE_SITTER_REUSE_ALLOCATOR>
                               $<$<CONFIG:Debug>:TREE_SITTER_DEBUG>)

    set_target_properties(tree-sitter-${name}
                          PROPERTIES
                          C_STANDARD 11
                          POSITION_INDEPENDENT_CODE ON
                          SOVERSION "${parser_abi}.${PROJECT_VERSION_MAJOR}"
                          DEFINE_SYMBOL "")

    configure_file("${CMAKE_SOURCE_DIR}/bindings/c/tree-sitter-${name}.pc.in"
                   "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-${name}.pc" @ONLY)

    install(FILES "${CMAKE_SOURCE_DIR}/bindings/c/tree-sitter-${name}.h"
            DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}/tree_sitter")
    install(FILES "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-${name}.pc"
            DESTINATION "${CMAKE_INSTALL_DATAROOTDIR}/pkgconfig")
    install(TARGETS tree-sitter-${name}
            LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}")
endmacro()

foreach(dir IN ITEMS LIBDIR INCLUDEDIR)
    if(IS_ABSOLUTE "${CMAKE_INSTALL_${dir}}")
        set(PC_${dir} "${CMAKE_INSTALL_${dir}}")
    else()
        set(PC_${dir} "\${prefix}/${CMAKE_INSTALL_${dir}}")
    endif()
endforeach()

add_subdirectory(typescript tree-sitter-typescript)

add_subdirectory(tsx tree-sitter-tsx)

if(TREE_SITTER_CLI)
    add_custom_target(ts-generate
                      COMMAND "${CMAKE_COMMAND}" -E chdir "${CMAKE_CURRENT_SOURCE_DIR}/typescript"
                              "${TREE_SITTER_CLI}" generate --abi "${TREE_SITTER_ABI_VERSION}" --js-runtime native
                      COMMAND "${CMAKE_COMMAND}" -E chdir "${CMAKE_CURRENT_SOURCE_DIR}/tsx"
                              "${TREE_SITTER_CLI}" generate --abi "${TREE_SITTER_ABI_VERSION}" --js-runtime native
                      VERBATIM)
    add_custom_target(ts-test "${TREE_SITTER_CLI}" test
                      WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                      VERBATIM)
endif()
