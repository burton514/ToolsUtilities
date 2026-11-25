from pathlib import Path

from mediatool_sdk.testing import run_example

TOOL_DIR = Path(__file__).resolve().parent.parent


def test_examples_pass():
    for result in run_example(TOOL_DIR, "all"):
        assert result.ok, result.error
