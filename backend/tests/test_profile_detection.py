from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from service.profile_detection import detect_profile


class ProfileDetectionTestCase(unittest.TestCase):
    def test_detects_vrm0_as_generic(self):
        result = detect_profile({"extensions": {"VRM": {}}}, source_path="sample.vrm")
        self.assertEqual(result.profile, "generic")
        self.assertIn("VRM extension", result.reason)

    def test_detects_vrm1_as_generic_without_vroid_hint(self):
        result = detect_profile(
            {"extensions": {"VRMC_vrm": {}}, "asset": {"generator": "UniVRM"}},
            source_path="sample.vrm",
        )
        self.assertEqual(result.profile, "generic")
        self.assertIn("VRMC_vrm", result.reason)

    def test_detects_vroid_when_hint_exists(self):
        result = detect_profile(
            {"extensions": {"VRMC_vrm": {}}, "asset": {"generator": "VRoid Studio"}},
            source_path="avatar.vrm",
        )
        self.assertEqual(result.profile, "vroid")
        self.assertIn("vroid hint", result.reason)

    def test_fallbacks_to_generic_on_unknown(self):
        result = detect_profile({"asset": {}}, source_path="unknown.glb")
        self.assertEqual(result.profile, "generic")
        self.assertIn("fallback", result.reason)


if __name__ == "__main__":
    unittest.main()
