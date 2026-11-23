import sys

from prepare import PROJECT

sys.path.insert(0, str(PROJECT / 'test/cst-regressions'))
from fixtures import GAP, MANIFEST, edit_source, included_ranges, load


def regression_inputs(cache):
    return load(cache / 'pinned-js')
