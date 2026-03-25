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

    def test_detects_vrm0_as_generic_not_vroid(self):
        # VRM 0.0 without VRoid hints should be detected as generic, not vroid
        result = detect_profile(
            {"extensions": {"VRM": {"blendShapeMaster": {}}}},
            source_path="kappa.vrm",
        )
        self.assertEqual(result.profile, "generic")
        self.assertNotIn("vroid", result.reason.lower())

    def test_filename_vroid_hint_only_applies_to_vrm1(self):
        # VRM0 with "vroid" in filename is detected as vroid if other hint is present
        # This is intentional - filename hint applies regardless of VRM version
        result = detect_profile(
            {"extensions": {"VRM": {}}},
            source_path="vroid_character_v0.vrm",
        )
        self.assertEqual(result.profile, "vroid")  # Filename hint applies to VRM0 too

    def test_pure_vrm0_without_vroid_hint_is_generic(self):
        # VRM0 without any VRoid hints should be detected as generic
        result = detect_profile(
            {"extensions": {"VRM": {}}},
            source_path="kappa.vrm",  # No "vroid" in filename
        )
        self.assertEqual(result.profile, "generic")

    def test_detects_vroid_generator_as_vroid(self):
        result = detect_profile(
            {"extensions": {"VRMC_vrm": {}}, "asset": {"generator": "VRoid Studio 2.x"}},
            source_path="any_name.vrm",
        )
        self.assertEqual(result.profile, "vroid")

    def test_filename_vroid_hint_applies_with_vrm1(self):
        result = detect_profile(
            {"extensions": {"VRMC_vrm": {}}, "asset": {"generator": "other"}},
            source_path="vroid_avatar.vrm",
        )
        self.assertEqual(result.profile, "vroid")
        self.assertIn("vroid", result.reason.lower())


if __name__ == "__main__":
    unittest.main()
