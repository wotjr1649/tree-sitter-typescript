import json
import os
import re
import sqlite3
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from threading import local

from inputs import EXT, oracle_args
from native import digest


class Tsc:
    def __init__(self, cache, root):
        self.cache = cache
        oracle = root / 'oracle'
        self.version = json.loads((oracle / 'package.json').read_bytes())['dependencies']['typescript']
        exes = list((oracle / 'node_modules/@typescript').glob('typescript-win32-*/lib/tsc.exe'))
        if len(exes) != 1:
            raise ValueError('Expected the one native Windows compiler from the oracle lockfile')
        self.exe = exes[0]
        self.env = dict(os.environ, GOMAXPROCS='1')
        result = subprocess.run([self.exe, '--version'], capture_output=True, check=True, env=self.env)
        if result.stdout.strip().decode('ascii') != f'Version {self.version}' or result.stderr:
            raise ValueError('Wrong oracle compiler version')
        self.args = oracle_args()
        self.key = digest(self.exe.read_bytes() + (oracle / 'package-lock.json').read_bytes()
                          + ' '.join(self.args).encode() + b'validity-v1')

    def check(self, dialect, source, folder, screening=False):
        name = f'case.{EXT[dialect]}'
        source_path = folder / name
        source_path.write_bytes(source)
        try:
            flags = self.args + (['--noLib'] if screening else [])
            result = subprocess.run([self.exe, *flags, name], cwd=folder, capture_output=True,
                                    env=self.env, timeout=120)
        finally:
            source_path.unlink()
        codes = []
        reported = 0
        diagnostic = re.compile(rb'([^ \t].*?)\(([1-9]\d*),([1-9]\d*)\): error TS([1-9]\d{0,4}): ')
        for line in result.stdout.splitlines():
            if not line:
                continue
            match = diagnostic.match(line)
            if match and match[1] == name.encode('ascii'):
                codes.append(int(match[4]))
                reported += 1
            elif screening and re.fullmatch(rb"error TS2318: Cannot find global type '[A-Za-z]+'.", line):
                # The no-library probe is used only to select a smaller source.
                reported += 1
            elif not (codes and line.startswith((b' ', b'\t'))
                      and not re.search(rb'error TS\d+:', line)):
                raise ValueError(f'Unexpected compiler diagnostic for {dialect} / {digest(source)}')
        if result.stderr or result.returncode not in (0, 1, 2) or (result.returncode == 0) != (reported == 0):
            raise ValueError(f'Inconsistent compiler result for {dialect} / {digest(source)}: '
                             f'exit {result.returncode}, stderr bytes {len(result.stderr)}')
        return {'valid': not codes, 'codes': codes, 'origin': 'tsc'}

    def verdicts(self, cases):
        todo = {}
        for case in cases:
            if case.verdict is None:
                todo.setdefault((case.dialect, digest(case.source())), case)
        path = self.cache / f'tsc-{self.key}.sqlite3'
        with closing(sqlite3.connect(path)) as db:
            db.execute('CREATE TABLE IF NOT EXISTS result (dialect TEXT, sha TEXT, data TEXT, PRIMARY KEY(dialect,sha))')
            cached = {(dialect, sha): json.loads(data)
                      for dialect, sha, data in db.execute('SELECT dialect, sha, data FROM result')}
            pending = todo.keys() - cached.keys()
            print(f'tsc {self.version}: {len(todo) - len(pending)} cached, {len(pending)} to check', flush=True)
            if pending:
                self.populate(db, cached, sorted(pending), todo)
        return cached

    def populate(self, db, cached, pending, todo):
        slot = local()
        with tempfile.TemporaryDirectory(dir=self.cache / 'tmp', prefix='tsc-') as directory:
            def check(key):
                if not hasattr(slot, 'folder'):
                    slot.folder = Path(tempfile.mkdtemp(dir=directory))
                case = todo[key]
                source = case.source()
                if digest(source) != key[1]:
                    raise ValueError(f'Input changed during comparison: {case.name}')
                return self.check(case.dialect, source, slot.folder)

            with ThreadPoolExecutor(max_workers=6) as pool:
                for index, (key, verdict) in enumerate(zip(pending, pool.map(check, pending)), 1):
                    db.execute('INSERT INTO result VALUES (?, ?, ?)', (*key, json.dumps(verdict)))
                    cached[key] = verdict
                    if index % 250 == 0:
                        db.commit()
                    if index % 2000 == 0:
                        print(f'tsc: {index}/{len(pending)} checked', flush=True)
                db.commit()
