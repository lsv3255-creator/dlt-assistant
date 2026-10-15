"""Offline UI fixture only; never checks generated fake records into public data."""
import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
from scripts import ai_cycle as m
from tests.test_ai_cycle import fake_response,fixture_root
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);fixture_root(root)
    with patch.object(m,'ROOT',root),contextlib.redirect_stdout(io.StringIO()):
        output=m.run(fake_response)
    Path(sys.argv[1]).write_text(json.dumps(output,ensure_ascii=False))
