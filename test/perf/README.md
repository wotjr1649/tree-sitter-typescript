# Incremental parsing benchmark

## Compare a grammar PR against main

From a checkout containing this tool, fetch `main` and pass the two committed
revisions. Use the PR revision that includes its generated parsers.

```sh
git fetch --no-tags origin main
python test/perf/bench.py origin/main HEAD
```

Use Git, Python 3.12 or later with its standard library, and a GCC- or
Clang-compatible C compiler. The default is `gcc` on Windows (MSYS2 UCRT64)
and `cc` on Linux and macOS. Use `--cc` to choose a compiler.

The first run fetches the Tree-sitter v0.25.0 C runtime at
`16aaed78ae6582ea55a94419828922c7b0960e10` and the example commits in
[test/examples/repos.txt](../examples/repos.txt) into `build/perf/cache/`.
Later runs use those local commits. The runner builds one C runtime and
links it to each revision's committed `parser.c` and `scanner.c` for both
grammars. This keeps the runtime and optimization flags the same for both
revisions. [Tree-sitter runtime source](https://github.com/tree-sitter/tree-sitter/tree/16aaed78ae6582ea55a94419828922c7b0960e10/lib)

Run paired comparisons on the same machine with a quiet workload. The
default four rounds alternate base and candidate order and swap which
dialect runs first. Use `--rounds` for a different even count. On Windows,
set `PERF_CPU` to the index of a logical CPU to pin each driver process.
The output is a Markdown table you can redirect to a file and include with
a PR. See the [recorded baseline](BASELINE.md).

## Workload and measurements

Both revisions read the same raw Git blobs for tracked `.ts` and `.tsx`
files at the example pins from the tool checkout. The default sample keeps
every 24th TypeScript path in Git tree order and the 12 largest TypeScript
files per repository, plus every TSX file. Use `--size full` for every
file or `--size smoke --rounds 2` for the first two files per dialect
per repository. Each process warms up on a fixed slice of the sample.

Each file is parsed fresh for each round. Each subsequent edit starts from
its own copy of that tree. The edits insert a space at the start of the
line containing the midpoint, type a character at the end of a nearby
declaration name, insert an indented comment line, delete a nearby nonblank
whole line, or replace a character in a nearby member name, string or
comment. The byte patterns skip edits when there is no match and can
produce incomplete programs.

Wall time covers `ts_parser_parse_string`. Input construction, tree
copying and `ts_tree_edit` happen before timing the edit parse. The report
pools samples across rounds for each edit and dialect. It gives the median,
nearest-rank p90, p99 and p99.9, maximum and count of parses over 16 ms.
The fresh-parse median uses the same file sample. Peak RSS is the highest
driver-process resident memory (peak working set on Windows) across
rounds, including warm-up.

Use the results as a manual comparison, with particular care around
maximum latency and small tail samples. Lexer and reuse counts would
require runtime instrumentation or a parser logger and are outside the
timed run.
