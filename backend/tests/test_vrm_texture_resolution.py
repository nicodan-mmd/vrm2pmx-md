"""Tests for VRM material main texture index resolution."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from mmd.VrmReader import VrmReader


class VrmMainTextureResolutionTestCase(unittest.TestCase):
    def test_resolve_maintex_from_vrm0_texture_props(self):
        material = {"name": "Body", "pbrMetallicRoughness": {}}
        texture_props = {"_MainTex": 2}
        json_data = {"textures": [{"source": 0}, {"source": 1}, {"source": 2}]}

        texture_index, source = VrmReader._resolve_main_texture_index(
            material,
            texture_props,
            json_data,
            pmx_texture_count=4,
        )

        self.assertEqual(texture_index, 3)
        self.assertEqual(source, "_MainTex")

    def test_resolve_base_color_texture_for_vrm1(self):
        material = {
            "name": "Body",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 1},
            },
        }
        texture_props = {}
        json_data = {
            "textures": [
                {"source": 0},
                {"source": 2},
            ]
        }

        texture_index, source = VrmReader._resolve_main_texture_index(
            material,
            texture_props,
            json_data,
            pmx_texture_count=5,
        )

        self.assertEqual(texture_index, 3)
        self.assertEqual(source, "baseColorTexture")

    def test_out_of_range_returns_minus_one(self):
        material = {
            "name": "Body",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 5},
            },
        }
        texture_props = {}
        json_data = {
            "textures": [
                {"source": 0},
            ]
        }

        texture_index, source = VrmReader._resolve_main_texture_index(
            material,
            texture_props,
            json_data,
            pmx_texture_count=2,
        )

        self.assertEqual(texture_index, -1)
        self.assertEqual(source, "baseColorTexture_index_out_of_range")

    def test_resolve_base_color_texture_with_khr_texture_basisu_source(self):
        material = {
            "name": "Body",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
            },
        }
        texture_props = {}
        json_data = {
            "textures": [
                {"extensions": {"KHR_texture_basisu": {"source": 1}}},
            ]
        }

        texture_index, source = VrmReader._resolve_main_texture_index(
            material,
            texture_props,
            json_data,
            pmx_texture_count=4,
        )

        self.assertEqual(texture_index, 2)
        self.assertEqual(source, "baseColorTexture")

    def test_resolve_mtoon_lit_multiply_texture_fallback(self):
        material = {
            "name": "Body",
            "extensions": {
                "VRMC_materials_mtoon": {
                    "litMultiplyTexture": {"index": 0}
                }
            },
        }
        texture_props = {}
        json_data = {
            "textures": [
                {"source": 2},
            ]
        }

        texture_index, source = VrmReader._resolve_main_texture_index(
            material,
            texture_props,
            json_data,
            pmx_texture_count=5,
        )

        self.assertEqual(texture_index, 3)
        self.assertEqual(source, "baseColorTexture")


if __name__ == "__main__":
    unittest.main()
