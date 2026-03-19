import importlib
import io
import json
import sys
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


def load_app_module():
    sys.modules.pop("backend.app.main", None)
    bone_panel_module = types.ModuleType("form.panel.BonePanel")
    bone_panel_module.BONE_PAIRS = {"root": "Root"}
    bone_panel_module.RIGIDBODY_PAIRS = {"body": "Body"}
    bone_panel_module.MORPH_PAIRS = {"blink": "Blink"}
    sys.modules["form.panel.BonePanel"] = bone_panel_module
    return importlib.import_module("backend.app.main")


class MainApiTestCase(unittest.TestCase):
    def setUp(self):
        self.app_module = load_app_module()
        self.client = TestClient(self.app_module.app)

    def tearDown(self):
        self.client.close()
        sys.modules.pop("backend.app.main", None)

    def test_health_returns_ok(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_convert_rejects_unsupported_extension(self):
        response = self.client.post(
            "/api/convert",
            files={"vrm_file": ("avatar.txt", b"not-a-vrm", "text/plain")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Only .vrm or .glb is supported"})

    def test_convert_rejects_invalid_json_config(self):
        response = self.client.post(
            "/api/convert",
            files={"vrm_file": ("avatar.vrm", b"vrm-data", "application/octet-stream")},
            data={"bone_config": "{invalid-json"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid JSON", response.json()["detail"])

    def test_convert_returns_zip_with_pmx_and_textures(self):
        fake_model = self.app_module.VrmModel()

        class FakeReader:
            def __init__(self, *_args, **_kwargs):
                pass

            def read_data(self):
                return fake_model

        class FakeService:
            def __init__(self, options):
                self.options = options

            def execute(self):
                output_path = Path(self.options.output_path)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(b"pmx-binary")
                texture_dir = output_path.parent / "tex"
                texture_dir.mkdir(parents=True, exist_ok=True)
                (texture_dir / "albedo.png").write_bytes(b"png-binary")
                return True

        with patch.object(self.app_module, "VrmReader", FakeReader), patch.object(
            self.app_module, "Vrm2PmxExportService", FakeService
        ):
            response = self.client.post(
                "/api/convert",
                files={
                    "vrm_file": ("avatar.vrm", b"vrm-data", "application/octet-stream")
                },
                data={"bone_config": json.dumps({"hips": "Hips"})},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("application/zip"))
        self.assertIn("avatar_pmx.zip", response.headers.get("content-disposition", ""))

        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            names = sorted(archive.namelist())

        self.assertIn("result.pmx", names)
        self.assertIn("tex/albedo.png", names)


if __name__ == "__main__":
    unittest.main()
