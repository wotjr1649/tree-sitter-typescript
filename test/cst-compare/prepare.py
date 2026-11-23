import json
import os
import re
import subprocess
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
BUILD = PROJECT / 'build/cst-compare'
RUNTIME_MODULE = 'github.com/tree-sitter/go-tree-sitter'


def command(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def revision(ref):
    return command('git', '-C', PROJECT, 'rev-parse', '--verify', '--end-of-options',
                   f'{ref}^{{commit}}', capture_output=True, text=True).stdout.strip()


def snapshot(cache, sha):
    root = cache / 'revisions' / sha
    if not (root / '.ready').is_file():
        root.mkdir(parents=True, exist_ok=True)
        archive = root / 'source.tar'
        command('git', '-C', PROJECT, 'archive', '-o', archive, sha)
        with tarfile.open(archive) as source:
            source.extractall(root, filter='data')
        archive.unlink()
        (root / '.ready').touch()
    return root


def config_lines(path):
    return [line for line in path.read_text(encoding='utf-8').splitlines()
            if line.strip() and not line.lstrip().startswith('#')]


def pins(root):
    for line in config_lines(root / 'test/examples/repos.txt'):
        name, url, commit = line.split()
        if not (re.fullmatch(r'[a-z0-9-]+', name) and
                re.fullmatch(r'https://github\.com/[\w.-]+/[\w.-]+', url) and
                re.fullmatch(r'[a-f0-9]{40}', commit)):
            raise ValueError(f'Invalid example pin: {line}')
        yield name, url, commit


def example_folder(cache, name, commit):
    return cache / 'examples' / name / commit


def prepare_example(cache, pin):
    name, url, commit = pin
    folder = example_folder(cache, name, commit)
    repo, sources = folder / 'git', folder / 'sources'
    if (sources / '.ready').is_file():
        return
    if not (repo / 'HEAD').is_file():
        folder.mkdir(parents=True, exist_ok=True)
        command('git', 'init', '--bare', '-q', repo)
    command('git', '-C', repo, 'fetch', '--no-tags', '--depth=1', url, commit)
    tree = command('git', '-C', repo, 'ls-tree', '-rz', '--name-only', commit,
                   capture_output=True).stdout.decode('utf-8').split('\0')
    expected = {path for path in tree if path.endswith(('.ts', '.tsx'))}
    archive = folder / 'sources.tar'
    command('git', '-C', repo, 'archive', '-o', archive, commit, '--', '*.ts', '*.tsx')
    with tarfile.open(archive) as files:
        members = [item for item in files if item.name in expected and item.isfile()]
        if {item.name for item in members} != expected:
            raise ValueError(f'{name}: archive lacks tracked TypeScript inputs')
        files.extractall(sources, members, filter='data')
    archive.unlink()
    (sources / '.ready').write_text(commit, encoding='ascii')
    print(f'{name}: {len(expected)} example files', flush=True)


def runtime(cache, root):
    replay = root / 'oracle/replay'
    match = re.search(rf'^\s*(?:require\s+)?{re.escape(RUNTIME_MODULE)} (v\S+)$',
                      (replay / 'go.mod').read_text(encoding='utf-8'), re.M)
    if not match:
        raise ValueError('Missing Tree-sitter runtime pin in oracle/replay/go.mod')
    version = match[1]
    env = dict(os.environ, GOMODCACHE=str(cache / 'gomodcache'), GOCACHE=str(cache / 'gocache'),
               GOWORK='off', GOTOOLCHAIN='local')
    result = command('go', 'mod', 'download', '-json', f'{RUNTIME_MODULE}@{version}',
                     cwd=root, env=env, capture_output=True)
    info = json.loads(result.stdout)
    sums = set((replay / 'go.sum').read_text(encoding='utf-8').splitlines())
    if not {f"{RUNTIME_MODULE} {version} {info['Sum']}",
            f"{RUNTIME_MODULE} {version}/go.mod {info['GoModSum']}"} <= sums:
        raise ValueError('Runtime does not match the replay checksums')
    return Path(info['Dir']), version, info['Sum']


def prepare_tsc(cache, root):
    oracle = root / 'oracle'
    if not (oracle / 'node_modules/.ready').is_file():
        command('npm.cmd', 'ci', '--ignore-scripts', '--no-audit', '--no-fund',
                '--cache', cache / 'npm', cwd=oracle)
        (oracle / 'node_modules/.ready').touch()
    command('node', 'run.mjs', '--self-test', cwd=oracle)


def prepare(cache, root, example_pins):
    with ThreadPoolExecutor(max_workers=5) as pool:
        examples = [pool.submit(prepare_example, cache, pin) for pin in example_pins]
        compiler = pool.submit(prepare_tsc, cache, root)
        tree_sitter = pool.submit(runtime, cache, root)
        for future in [*examples, compiler]:
            future.result()
        return tree_sitter.result()
