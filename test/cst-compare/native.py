import ctypes as c
import json
import os
import re
import shutil
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path

from prepare import ROOT, command

LANGUAGES = ('typescript', 'tsx')
PRAGMA = re.compile(rb'^[ \t]*#[ \t]*pragma[ \t]+(?:optimize[ \t]*\(|'
                    rb'clang[ \t]+optimize[ \t]+off\b|GCC[ \t]+optimize\b)', re.M)


def digest(data):
    return sha256(data).hexdigest()


def stamp(files):
    return digest(b''.join(sha256(path.read_bytes()).digest() for path in files))


def content(root, language):
    src = root / language / 'src'
    return sorted(path for path in src.rglob('*')
                  if path.is_file() and (path.name in ('parser.c', 'grammar.json', 'node-types.json')
                                        or path.parent.name == 'tree_sitter'))


def pinned_cli(root, executable):
    cli = shutil.which(executable)
    if cli is None:
        raise ValueError(f'Tree-sitter CLI not found: {executable}')
    path = Path(cli).resolve()
    pin = json.loads((root / 'package.json').read_bytes())['devDependencies']['tree-sitter-cli']
    version = command(path, '--version', capture_output=True, text=True).stdout.strip()
    if version.split()[:2] != ['tree-sitter', pin]:
        raise ValueError(f'{root.name} needs tree-sitter {pin}, got {version}')
    return path, version


def parser_abi(parser):
    return int(re.search(rb'^#define LANGUAGE_VERSION (\d+)$', parser, re.M)[1])


def generate(cache, root, language, cli):
    parser = (root / language / 'src/parser.c').read_bytes()
    abi_file = root / 'ci/tree-sitter-abi.txt'
    # Older revisions may pin the ABI only in the generated parser.
    abi = int(abi_file.read_text(encoding='ascii')) if abi_file.is_file() else parser_abi(parser)
    if parser_abi(parser) != abi:
        raise ValueError(f'{root.name}: {language} parser does not use the pinned ABI {abi}')
    files = [root / name for name in ('tree-sitter.json', 'common/define-grammar.js',
                                      'third_party/tree-sitter-javascript/grammar.js',
                                      f'{language}/grammar.js')]
    target = cache / 'generated' / language / str(abi) / stamp([cli, *files])
    if not (target / '.ready').exists():
        for path in files:
            dest = target / path.relative_to(root)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest)
        print(f'Generating {language} from {root.name}', flush=True)
        command(cli, 'generate', '--abi', str(abi), '--js-runtime', 'native',
                cwd=target / language, env=dict(os.environ, RAYON_NUM_THREADS='3'))
        (target / '.ready').touch()
    committed = {p.relative_to(root).as_posix(): digest(p.read_bytes()) for p in content(root, language)}
    generated = {p.relative_to(target).as_posix(): digest(p.read_bytes()) for p in content(target, language)}
    regenerated = (target / language / 'src/parser.c').read_bytes()

    def lexer(data):
        result = re.search(rb'^static bool ts_lex\(.*?^}', data, re.M | re.S)
        if not result:
            raise ValueError('Missing main lexer in generated parser.c')
        return len(re.findall(rb'^[ \t]*case [0-9]+:', result[0], re.M))

    return {'generated_drift': sorted(k for k in committed.keys() | generated.keys()
                                       if committed.get(k) != generated.get(k)),
            'abi': abi,
            'parser_sha256': digest(parser), 'regenerated_parser_sha256': digest(regenerated),
            'main_lexer_cases': lexer(parser), 'regenerated_main_lexer_cases': lexer(regenerated),
            'forbidden_pragmas': len(PRAGMA.findall(parser)),
            'regenerated_forbidden_pragmas': len(PRAGMA.findall(regenerated))}


def build_grammar(cache, root, language):
    src = root / language / 'src'
    files = [src / 'parser.c', src / 'scanner.c', root / 'common/scanner.h',
             *sorted((src / 'tree_sitter').glob('*.h'))]
    folder = cache / 'grammar' / language / stamp(files)
    folder.mkdir(parents=True, exist_ok=True)
    library = folder / f'{language}.dll'
    if not library.exists():
        print(f'Building {language} from {root.name}', flush=True)
        temp = folder / f'{language}.building.dll'
        command('gcc', '-shared', '-O2', '-std=c11', '-I', src, files[0], files[1], '-o', temp)
        temp.replace(library)
    return library


def build_runtime(cache, src, checksum):
    key = digest(checksum.encode('ascii') + (ROOT / 'compare.c').read_bytes())
    folder = cache / 'runtime' / key
    folder.mkdir(parents=True, exist_ok=True)
    library = folder / 'tree-sitter.dll'
    if not library.exists():
        temp = folder / 'tree-sitter.building.dll'
        command('gcc', '-shared', '-O2', '-std=c11', '-D_DEFAULT_SOURCE', '-I', src / 'include',
                '-I', src / 'src', src / 'src/lib.c', ROOT / 'compare.c', '-o', temp)
        temp.replace(library)
    return library


class Point(c.Structure):
    _fields_ = [('row', c.c_uint32), ('column', c.c_uint32)]


class Node(c.Structure):
    _fields_ = [('context', c.c_uint32 * 4), ('id', c.c_void_p), ('tree', c.c_void_p)]


class Difference(c.Structure):
    _fields_ = [('before', Node), ('after', Node), ('before_field', c.c_char_p),
                ('after_field', c.c_char_p)]


class Edit(c.Structure):
    _fields_ = [('start_byte', c.c_uint32), ('old_end_byte', c.c_uint32), ('new_end_byte', c.c_uint32),
                ('start_point', Point), ('old_end_point', Point), ('new_end_point', Point)]


class Range(c.Structure):
    _fields_ = [('start_point', Point), ('end_point', Point), ('start_byte', c.c_uint32),
                ('end_byte', c.c_uint32)]


def point(source, end):
    prefix = source[:end]
    return Point(prefix.count(b'\n'), len(prefix) - 1 - prefix.rfind(b'\n'))


def bind(library, name, result, *args):
    function = getattr(library, name)
    function.restype = result
    function.argtypes = args
    return function


class Runtime:
    def __init__(self, library):
        dll = c.CDLL(str(library))
        pointer, byte = c.c_void_p, c.c_uint32
        self.new = bind(dll, 'ts_parser_new', pointer)
        self.delete = bind(dll, 'ts_parser_delete', None, pointer)
        self.reset = bind(dll, 'ts_parser_reset', None, pointer)
        self.set_timeout = bind(dll, 'ts_parser_set_timeout_micros', None, pointer, c.c_uint64)
        self.set_language = bind(dll, 'ts_parser_set_language', c.c_bool, pointer, pointer)
        self.parse = bind(dll, 'ts_parser_parse_string', pointer, pointer, pointer, c.c_char_p, byte)
        self.set_ranges = bind(dll, 'ts_parser_set_included_ranges', c.c_bool, pointer, c.POINTER(Range), byte)
        self.delete_tree = bind(dll, 'ts_tree_delete', None, pointer)
        self.edit = bind(dll, 'ts_tree_edit', None, pointer, c.POINTER(Edit))
        self.root = bind(dll, 'ts_tree_root_node', Node, pointer)
        self.parent = bind(dll, 'ts_node_parent', Node, Node)
        self.descendant = bind(dll, 'ts_node_descendant_for_byte_range', Node, Node, byte, byte)
        self.has_error = bind(dll, 'ts_node_has_error', c.c_bool, Node)
        self.kind = bind(dll, 'ts_node_type', c.c_char_p, Node)
        self.start = bind(dll, 'ts_node_start_byte', byte, Node)
        self.end = bind(dll, 'ts_node_end_byte', byte, Node)
        self.start_point = bind(dll, 'ts_node_start_point', Point, Node)
        self.end_point = bind(dll, 'ts_node_end_point', Point, Node)
        self.flags = {key: bind(dll, f'ts_node_is_{key}', c.c_bool, Node)
                      for key in ('named', 'extra', 'error', 'missing')}
        self.compare = bind(dll, 'compare_trees', c.c_bool, pointer, pointer, c.POINTER(Difference))

    def node_info(self, node, field):
        if not node.id:
            return None
        start, end = self.start_point(node), self.end_point(node)
        parent = self.parent(node)
        return {'kind': self.kind(node).decode(), 'field': field.decode() or None,
                'parent': self.kind(parent).decode() if parent.id else None,
                'bytes': [self.start(node), self.end(node)],
                'points': [[start.row, start.column], [end.row, end.column]],
                **{key: test(node) for key, test in self.flags.items()}}

    def difference(self, before, after):
        diff = Difference()
        if self.compare(before, after, c.byref(diff)):
            return None
        return {'before': self.node_info(diff.before, diff.before_field),
                'after': self.node_info(diff.after, diff.after_field)}

    def contexts(self, parser, source, difference):
        nodes = [node for node in difference.values() if node]
        lo = min(node['bytes'][0] for node in nodes)
        hi = max(node['bytes'][1] for node in nodes)
        with self.tree(parser, source) as tree:
            node = self.descendant(self.root(tree), lo, hi)
            if not node.id:
                return
            lo, hi = self.start(node), self.end(node)
            fragment = source[lo:hi]
            while (parent := self.parent(node)).id:
                start, end = self.start(parent), self.end(parent)
                kind = self.kind(parent)
                if kind in (b'statement_block', b'class_body'):
                    fragment = b'{\n' + fragment + b'\n}'
                elif kind != b'program':
                    fragment = source[start:lo] + fragment + source[hi:end]
                if len(fragment) < len(source):
                    yield fragment
                lo, hi, node = start, end, parent

    @contextmanager
    def parser(self, library, dialect):
        grammar = c.CDLL(str(library))
        get_language = bind(grammar, f'tree_sitter_{dialect}', c.c_void_p)
        parser = self.new()
        try:
            if not self.set_language(parser, get_language()):
                raise RuntimeError(f'Runtime refused {dialect} from {library}')
            yield parser
        finally:
            self.delete(parser)

    @contextmanager
    def tree(self, parser, source, old=None, allow_timeout=False):
        tree = self.parse(parser, old, source, len(source))
        if not tree:
            if allow_timeout:
                self.reset(parser)
                yield None
                return
            raise RuntimeError('Native parse failed')
        try:
            yield tree
        finally:
            self.delete_tree(tree)

    def ranges(self, parser, source, intervals):
        array = (Range * len(intervals))(*(Range(point(source, a), point(source, b), a, b)
                                          for a, b in intervals))
        if not self.set_ranges(parser, array, len(array)):
            raise ValueError(f'Invalid included ranges: {intervals}')

    def self_test(self, library, dialect):
        with self.parser(library, dialect) as parser:
            with self.tree(parser, b'let x=1;') as a, self.tree(parser, b'let x=1;') as b:
                assert self.difference(a, b) is None
            with self.tree(parser, b'let x=1;') as a, self.tree(parser, b'let x=1') as b:
                assert self.difference(a, b) is not None
            with self.tree(parser, b'let x=1') as a, self.tree(parser, b' let x=1') as b:
                assert self.difference(a, b) is not None
