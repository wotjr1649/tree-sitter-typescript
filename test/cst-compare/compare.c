#include <stdbool.h>
#include <string.h>
#include "tree_sitter/api.h"

typedef struct {
    TSNode before;
    TSNode after;
    const char *before_field;
    const char *after_field;
} Difference;

static bool same_point(TSPoint a, TSPoint b) {
    return a.row == b.row && a.column == b.column;
}

static const char *field(const TSTreeCursor *cursor) {
    const char *name = ts_tree_cursor_current_field_name(cursor);
    return name ? name : "";
}

bool compare_trees(const TSTree *before, const TSTree *after, Difference *difference) {
    TSTreeCursor a = ts_tree_cursor_new(ts_tree_root_node(before));
    TSTreeCursor b = ts_tree_cursor_new(ts_tree_root_node(after));
    bool equal = false;
    for (;;) {
        TSNode left = ts_tree_cursor_current_node(&a);
        TSNode right = ts_tree_cursor_current_node(&b);
        if (strcmp(ts_node_type(left), ts_node_type(right)) ||
            strcmp(field(&a), field(&b)) ||
            ts_node_is_named(left) != ts_node_is_named(right) ||
            ts_node_is_extra(left) != ts_node_is_extra(right) ||
            ts_node_is_error(left) != ts_node_is_error(right) ||
            ts_node_is_missing(left) != ts_node_is_missing(right) ||
            ts_node_start_byte(left) != ts_node_start_byte(right) ||
            ts_node_end_byte(left) != ts_node_end_byte(right) ||
            !same_point(ts_node_start_point(left), ts_node_start_point(right)) ||
            !same_point(ts_node_end_point(left), ts_node_end_point(right))) {
            *difference = (Difference) {left, right, field(&a), field(&b)};
            break;
        }
        bool a_child = ts_tree_cursor_goto_first_child(&a);
        bool b_child = ts_tree_cursor_goto_first_child(&b);
        if (a_child || b_child) {
            if (a_child && b_child) continue;
            *difference = (Difference) {
                a_child ? ts_tree_cursor_current_node(&a) : (TSNode) {0},
                b_child ? ts_tree_cursor_current_node(&b) : (TSNode) {0},
                a_child ? field(&a) : "", b_child ? field(&b) : ""
            };
            break;
        }
        for (;;) {
            bool a_next = ts_tree_cursor_goto_next_sibling(&a);
            bool b_next = ts_tree_cursor_goto_next_sibling(&b);
            if (a_next || b_next) {
                if (a_next && b_next) break;
                *difference = (Difference) {
                    a_next ? ts_tree_cursor_current_node(&a) : (TSNode) {0},
                    b_next ? ts_tree_cursor_current_node(&b) : (TSNode) {0},
                    a_next ? field(&a) : "", b_next ? field(&b) : ""
                };
                goto done;
            }
            bool a_parent = ts_tree_cursor_goto_parent(&a);
            bool b_parent = ts_tree_cursor_goto_parent(&b);
            if (!a_parent && !b_parent) {
                equal = true;
                goto done;
            }
        }
    }
done:
    ts_tree_cursor_delete(&a);
    ts_tree_cursor_delete(&b);
    return equal;
}
