"""Compare incremental parse latency for two committed grammar revisions."""

import argparse
from collections import Counter
from itertools import groupby
import math
import os
from pathlib import Path
import platform
import re
import statistics
import struct
import subprocess
import sys
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RUNTIME = "16aaed78ae6582ea55a94419828922c7b0960e10"  # tree-sitter v0.25.0
RUNTIME_URL = "https://github.com/tree-sitter/tree-sitter.git"
DIALECTS = ("typescript", "tsx")
KINDS = ("fresh", "indent", "type", "insert_line", "delete_line", "member", "string", "comment")
FLAGS = ("-O2", "-std=c11", "-D_DEFAULT_SOURCE", "-D_POSIX_C_SOURCE=200809L")
IDENTIFIER = rb"[a-zA-Z_$][a-zA-Z0-9_$]+"
EDIT_PATTERNS = {
    2: re.compile(rb"\b(?:const|let|function|interface|type|class)[ \t]+(" + IDENTIFIER + rb")\b"),
    5: re.compile(rb"\.\s*(" + IDENTIFIER + rb")\b"),
    6: re.compile(rb"""(?:"([A-Za-z][A-Za-z0-9 _./-]*)"|'([A-Za-z][A-Za-z0-9 _./-]*)')"""),
    7: re.compile(rb"(?m)^[ \t]*(?://|/\*+|\*)[ \t]+([a-zA-Z][a-zA-Z0-9 _.,-]+)"),
}


def git(repo, *args):
    return subprocess.check_output(("git", "-C", repo, *args))


def cached_repo(cache, name, url, commit):
    repo = cache / f"{name}-{commit}"
    if not (repo / "HEAD").is_file():
        subprocess.run(("git", "init", "--bare", "-q", repo), check=True)
    ref = "refs/benchmark/input"
    if subprocess.run(("git", "-C", repo, "show-ref", "--verify", "--quiet", ref)).returncode:
        subprocess.run(("git", "-C", repo, "fetch", "--quiet", "--no-tags", "--depth=1",
                        url, f"{commit}:{ref}"), check=True)
    if git(repo, "rev-parse", ref + "^{commit}").strip() != commit.encode("ascii"):
        raise ValueError(f"{name}: cached commit differs from {commit}")
    return repo


def snapshot(repo, commit, folder, *paths):
    folder.mkdir()
    archive = folder / "source.tar"
    git(repo, "-c", "core.autocrlf=false", "archive", "-o", archive, commit, "--", *paths)
    with tarfile.open(archive) as source:
        source.extractall(folder, filter="data")
    archive.unlink()


def edit_cases(source):
    mid = len(source) // 2
    line = source.rfind(b"\n", 0, mid) + 1
    newline = b"\r\n" if b"\r\n" in source else b"\n"
    indent = re.match(rb"[ \t]*", source[line:]).group()
    yield 1, line, line, b" "
    yield 3, line, line, indent + b"// editing" + newline
    complete = ((match.start(), match.end())
                for match in re.finditer(rb"(?m)^[^\n]*\n", source) if match[0].strip())
    nearest = min(complete, key=lambda match: abs(match[0] - mid), default=None)
    if nearest:
        yield 4, *nearest, b""
    for kind, pattern in EDIT_PATTERNS.items():
        match = min(pattern.finditer(source), key=lambda item: abs(item.start() - mid), default=None)
        if match is None:
            continue
        start, end = match.span(match.lastindex)
        if kind == 2:
            yield kind, end, end, b"x"
        else:
            position = start + (end - start) // 2
            yield kind, position, position + 1, b"y" if source[position] == ord("x") else b"x"


def check_edits():
    source = b"const name = value.member;\r\n  // comment\r\nconst key = 'word';\r\n"
    edits = {KINDS[kind]: source[:start] + data + source[end:]
             for kind, start, end, data in edit_cases(source)}
    assert edits == {
        "indent": source.replace(b"  //", b"   //"),
        "type": source.replace(b"key", b"keyx"),
        "insert_line": source.replace(b"  // comment", b"  // editing\r\n  // comment"),
        "delete_line": source.replace(b"  // comment\r\n", b""),
        "member": source.replace(b"member", b"memxer"),
        "string": source.replace(b"word", b"woxd"),
        "comment": source.replace(b"comment", b"comxent"),
    }


def example_inputs(cache, size):
    measured = {dialect: [] for dialect in DIALECTS}
    sample = {dialect: [] for dialect in DIALECTS}
    pins = ROOT / "test/examples/repos.txt"
    for line in pins.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, url, commit = line.split()
        if not (re.fullmatch(r"[a-z0-9-]+", name) and
                re.fullmatch(r"https://github\.com/[\w.-]+/[\w.-]+", url) and
                re.fullmatch(r"[a-f0-9]{40}", commit)):
            raise ValueError(f"Invalid example pin for {name}")
        print(f"- {name} {commit}", flush=True)
        repo = cached_repo(cache, name, url, commit)
        tree = git(repo, "ls-tree", "-lrz", commit)
        files = {dialect: [] for dialect in DIALECTS}
        for entry in tree.rstrip(b"\0").split(b"\0"):
            metadata, _, path = entry.partition(b"\t")
            if path.endswith((b".ts", b".tsx")):
                mode, _, blob, length = metadata.split()
                if mode in (b"100644", b"100755"):
                    dialect = "tsx" if path.endswith(b".tsx") else "typescript"
                    files[dialect].append((repo, blob, int(length)))
        for dialect, rows in files.items():
            if size == "smoke":
                selected = rows[:2]
            elif dialect == "typescript":
                indices = set(range(0, len(rows), 24))
                indices.update(sorted(range(len(rows)), key=lambda i: rows[i][2])[-12:])
                selected = [rows[i] for i in sorted(indices)]
            else:
                selected = rows
            sample[dialect].extend(selected)
            measured[dialect].extend(rows if size == "full" else selected)
    warm = {dialect: rows[::max(1, len(rows) // 24)] for dialect, rows in sample.items()}
    return measured, warm


def write_pack(path, entries):
    if not entries:
        raise ValueError(f"No inputs for {path.name}")
    counts = Counter()
    with path.open("wb") as out:
        out.write(struct.pack("<I", len(entries)))
        for repo, rows in groupby(entries, key=lambda row: row[0]):
            with subprocess.Popen(("git", "-C", repo, "cat-file", "--batch"),
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE) as batch:
                for _, blob, size in rows:
                    batch.stdin.write(blob + b"\n")
                    batch.stdin.flush()
                    header = batch.stdout.readline().split()
                    if header != [blob, b"blob", str(size).encode("ascii")]:
                        raise ValueError(f"Unexpected Git blob header in {repo.name}")
                    source = batch.stdout.read(size)
                    if len(source) != size or batch.stdout.read(1) != b"\n":
                        raise ValueError(f"Truncated Git blob in {repo.name}")
                    edits = sorted(edit_cases(source))
                    out.write(struct.pack("<II", size, len(edits)))
                    out.write(source)
                    counts[0] += 1
                    for kind, start, end, data in edits:
                        out.write(struct.pack("<IIII", kind, start, end, len(data)))
                        out.write(data)
                        counts[kind] += 1
                batch.stdin.close()
                if batch.wait():
                    raise subprocess.CalledProcessError(batch.returncode, batch.args)
    return counts


def compile_drivers(work, runtime, commits, cc):
    native = work / "runtime"
    snapshot(runtime, RUNTIME, native, "lib/include", "lib/src")
    inc = native / "lib/include"
    src = native / "lib/src"
    obj = native / "runtime.o"
    subprocess.run((cc, *FLAGS, "-I", inc, "-I", src, "-c", src / "lib.c", "-o", obj),
                   check=True)
    grammar_paths = ("common/scanner.h", *(f"{dialect}/src/{part}" for dialect in DIALECTS
                     for part in ("parser.c", "scanner.c", "tree_sitter")))
    drivers = {}
    for revision, commit in zip(("base", "candidate"), commits):
        folder = work / revision
        snapshot(ROOT, commit, folder, *grammar_paths)
        for dialect in DIALECTS:
            grammar = folder / dialect / "src"
            exe = folder / f"{dialect}.exe"
            libs = ("-lpsapi",) if sys.platform == "win32" else ()
            subprocess.run((cc, *FLAGS, "-I", inc, "-I", grammar,
                            f"-DBENCH_LANGUAGE=tree_sitter_{dialect}", HERE / "driver.c", obj,
                            grammar / "parser.c", grammar / "scanner.c", *libs, "-o", exe), check=True)
            drivers[revision, dialect] = exe
    return drivers


def measure(executable, dialect, work, counts):
    output = subprocess.check_output((executable, f"{dialect}.bin", f"{dialect}-warm.bin"),
                                     cwd=work, text=True).splitlines()
    header, *rows, footer = [line.split(",") for line in output]
    if header[0] != "frequency" or footer[0] != "peak_rss":
        raise ValueError("Driver output is missing timing or memory metadata")
    frequency = int(header[1])
    samples = {kind: [] for kind in counts}
    for kind, ticks in rows:
        samples[int(kind)].append(1000 * int(ticks) / frequency)
    if {kind: len(values) for kind, values in samples.items()} != counts:
        raise ValueError("Driver sample counts differ from the input pack")
    return samples, int(footer[1])


def report(dialect, results, peak, rounds):
    print(f"\n## {dialect}\n")
    print("| Edit | Revision | Samples | Median ms | p90 ms | p99 ms | p99.9 ms | Max ms | >16 ms |")
    print("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    for kind in range(1, len(KINDS)):
        for revision in ("base", "candidate"):
            values = sorted(results[revision, dialect].get(kind, ()))
            if not values:
                continue
            percentiles = [values[math.ceil(p * len(values)) - 1] for p in (.9, .99, .999)]
            timings = [statistics.median(values), *percentiles, values[-1]]
            columns = " | ".join(f"{value:.3f}" for value in timings)
            over = sum(value > 16 for value in values)
            print(f"| {KINDS[kind]} | {revision} | {len(values)} | {columns} | {over} |")
    print()
    for revision in ("base", "candidate"):
        fresh = results[revision, dialect][0]
        rss = peak[revision, dialect] / 2**20
        print(f"- {revision} fresh median {statistics.median(fresh):.3f} ms "
              f"({len(fresh) // rounds} files per round), peak RSS {rss:.2f} MiB")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="base git revision")
    parser.add_argument("candidate", help="candidate git revision")
    parser.add_argument("--size", choices=("smoke", "sample", "full"), default="sample")
    parser.add_argument("--rounds", type=int, default=4, help="even number of rounds (default 4)")
    parser.add_argument("--cc", default="gcc" if sys.platform == "win32" else "cc")
    args = parser.parse_args()
    if args.rounds < 2 or args.rounds % 2:
        parser.error("--rounds must be a positive even number")
    check_edits()
    commits = [git(ROOT, "rev-parse", "--verify", "--end-of-options", f"{rev}^{{commit}}")
               .decode("ascii").strip() for rev in (args.base, args.candidate)]
    compiler = subprocess.check_output((args.cc, "--version"), text=True).splitlines()[0]
    print(f"- base {commits[0]}\n- candidate {commits[1]}")
    print(f"- {platform.platform()}, {platform.machine()}, Python {platform.python_version()}")
    print(f"- {compiler} {' '.join(FLAGS)}")
    print(f"- tree-sitter v0.25.0 {RUNTIME}")
    print(f"- {args.size}, {args.rounds} rounds")
    if sys.platform == "win32" and "PERF_CPU" in os.environ:
        print(f"- PERF_CPU {os.environ['PERF_CPU']}")
    cache = ROOT / "build/perf/cache"
    cache.mkdir(parents=True, exist_ok=True)
    runtime = cached_repo(cache, "tree-sitter", RUNTIME_URL, RUNTIME)
    measured, warm = example_inputs(cache, args.size)

    with tempfile.TemporaryDirectory(dir=cache.parent) as tmp:
        work = Path(tmp)
        counts = {}
        for dialect in DIALECTS:
            counts[dialect] = write_pack(work / f"{dialect}.bin", measured[dialect])
            write_pack(work / f"{dialect}-warm.bin", warm[dialect])
        print("Building drivers", file=sys.stderr, flush=True)
        drivers = compile_drivers(work, runtime, commits, args.cc)
        results = {key: {kind: [] for kind in counts[key[1]]} for key in drivers}
        peak = dict.fromkeys(drivers, 0)
        for round_index in range(args.rounds):
            order = ("base", "candidate") if round_index % 2 == 0 else ("candidate", "base")
            dialects = DIALECTS if round_index % 2 == 0 else DIALECTS[::-1]
            print(f"Round {round_index + 1}: {' / '.join(order)}", file=sys.stderr, flush=True)
            for dialect in dialects:
                for revision in order:
                    key = (revision, dialect)
                    samples, rss = measure(drivers[key], dialect, work, counts[dialect])
                    for kind, values in samples.items():
                        results[key][kind].extend(values)
                    peak[key] = max(peak[key], rss)
    for dialect in DIALECTS:
        report(dialect, results, peak, args.rounds)


if __name__ == "__main__":
    main()
