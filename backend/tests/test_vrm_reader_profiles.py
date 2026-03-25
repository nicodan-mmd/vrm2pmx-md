from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from mmd.PmxData import Bone, PmxModel
from mmd.VrmReader import VrmReader
from module.MMath import MVector3D


class VrmReaderProfileTestCase(unittest.TestCase):
    def setUp(self):
        self.reader = VrmReader("dummy.vrm", is_check=False)

    def test_resolve_center_position_uses_vroid_formula(self):
        pmx = PmxModel()
        pmx.bones["腰"] = Bone("腰", "hips", MVector3D(0, 10, 0), -1, 0, 0)
        pmx.bones["左足"] = Bone("左足", "leftLeg", MVector3D(0, 4, 0), -1, 0, 0)
        pmx.bones["左ひざ"] = Bone("左ひざ", "leftLowerLeg", MVector3D(0, 2, 0), -1, 0, 0)

        actual = self.reader._resolve_center_position(pmx, "vroid")

        self.assertEqual(actual.x(), 0)
        self.assertEqual(actual.y(), 7)
        self.assertEqual(actual.z(), 0)

    def test_resolve_both_eyes_position_uses_eye_midpoint_for_vroid(self):
        pmx = PmxModel()
        pmx.bones["左目"] = Bone("左目", "leftEye", MVector3D(-1, 12, -3), -1, 0, 0)
        pmx.bones["右目"] = Bone("右目", "rightEye", MVector3D(1, 12, -3), -1, 0, 0)
        pmx.bones["頭"] = Bone("頭", "head", MVector3D(0, 11, -2), -1, 0, 0)
        pmx.bones["首"] = Bone("首", "neck", MVector3D(0, 10, -2), -1, 0, 0)
        pmx.bones["両目"] = Bone("両目", "eyes", MVector3D(), -1, 0, 0)

        actual = self.reader._resolve_both_eyes_position(pmx, "両目", "vroid")

        self.assertEqual(actual.x(), 0)
        self.assertEqual(actual.y(), 12)
        self.assertEqual(actual.z(), -3)

    def test_resolve_material_key_is_profile_aware(self):
        self.assertEqual(
            self.reader._resolve_material_key("N00_000_FaceEye_00", "OPAQUE", "vroid"),
            "Eye",
        )
        self.assertEqual(
            self.reader._resolve_material_key("N00_000_FaceEye_00", "OPAQUE", "generic"),
            "OPAQUE",
        )


if __name__ == "__main__":
    unittest.main()