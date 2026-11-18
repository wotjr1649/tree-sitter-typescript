#!/usr/bin/env bash
# Fails if known-failures.txt lists a path that the base revision ($1) did not list, unless repos.txt changed
# since the base (moving a pin rebuilds the list). Changing the reason of a listed path is allowed.
set -euo pipefail
base=${1:?usage: check-known-failures-shrink.sh <base-revision>}
list=test/examples/known-failures.txt
if ! git diff --quiet "$base" -- test/examples/repos.txt; then
  echo "repos.txt changed since $base: the list is rebuilt for the new pins, shrink check skipped."
  exit 0
fi
paths() { grep -v '^#' | cut -f1 | LC_ALL=C sort -u; }
added=$(LC_ALL=C comm -13 <(git show "$base:$list" 2>/dev/null | paths) <(paths < "$list"))
if [ -n "$added" ]; then
  echo "::error file=$list::known-failures.txt may only shrink; new entries with repos.txt unchanged:"
  echo "$added"
  exit 1
fi
echo "known-failures.txt adds no path relative to $base."
