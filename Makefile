TS ?= tree-sitter

all install uninstall clean generate:
	$(MAKE) -C typescript $@
	$(MAKE) -C tsx $@

test:
	$(TS) test
	$(TS) parse examples/* --quiet --time

.PHONY: all install uninstall clean generate test update
