import os
import subprocess
import sys
import sysconfig
from unittest import TestCase, skipUnless


class TestFreeThreading(TestCase):
    @skipUnless(sysconfig.get_config_var("Py_GIL_DISABLED"), "requires free-threaded CPython")
    def test_import_keeps_gil_disabled(self):
        env = os.environ.copy()
        env.pop("PYTHON_GIL", None)
        subprocess.run(
            [sys.executable, "-W", "error::RuntimeWarning", "-c",
             "import sys; assert not sys._is_gil_enabled(); "
             "import tree_sitter_typescript; assert not sys._is_gil_enabled()"],
            check=True,
            env=env,
        )
