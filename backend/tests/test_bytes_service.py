from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from service.Vrm2PmxBytesService import convert_vrm_bytes


class BytesServiceTestCase(unittest.TestCase):
    def test_convert_vrm_bytes_rejects_empty_input(self):
        with self.assertRaises(ValueError):
            convert_vrm_bytes(b"")

    def test_convert_vrm_bytes_returns_pmx_bytes(self):
        class FakeReader:
            def __init__(self, *_args, **_kwargs):
                pass

            def read_data(self):
                from mmd.VrmData import VrmModel

                return VrmModel()

        class FakeService:
            def __init__(self, options):
                self.options = options

            def execute(self):
                output_path = Path(self.options.output_path)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(b"pmx-bytes")
                return True

        with patch("service.Vrm2PmxBytesService.VrmReader", FakeReader), patch(
            "service.Vrm2PmxBytesService.Vrm2PmxExportService", FakeService
        ):
            actual = convert_vrm_bytes(b"dummy-vrm", file_suffix=".vrm")

        self.assertEqual(actual, b"pmx-bytes")


if __name__ == "__main__":
    unittest.main()
