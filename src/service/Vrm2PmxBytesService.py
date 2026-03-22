# -*- coding: utf-8 -*-
#
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

from config.default_pairs import BONE_PAIRS, RIGIDBODY_PAIRS
from mmd.VrmData import VrmModel
from mmd.VrmReader import VrmReader
from module.MOptions import MExportOptions
from service.Vrm2PmxExportService import Vrm2PmxExportService
from utils.MLogger import MLogger


def convert_vrm_bytes(
    vrm_bytes: bytes,
    *,
    bone_pairs: dict[str, Any] | None = None,
    physics_pairs: dict[str, Any] | None = None,
    file_suffix: str = ".vrm",
    version_name: str = "bytes-poc",
    logging_level: int = MLogger.INFO,
) -> bytes:
    if not vrm_bytes:
        raise ValueError("vrm_bytes must not be empty")

    if file_suffix.lower() not in {".vrm", ".glb"}:
        raise ValueError("file_suffix must be .vrm or .glb")

    tmp_dir = Path(tempfile.mkdtemp(prefix="vrm2pmx_bytes_"))
    input_path = tmp_dir / f"source{file_suffix.lower()}"
    output_path = tmp_dir / "result.pmx"

    try:
        input_path.write_bytes(vrm_bytes)

        vrm_model = VrmReader(str(input_path), is_check=False).read_data()
        if not isinstance(vrm_model, VrmModel):
            raise ValueError("invalid vrm bytes")

        options = MExportOptions(
            version_name=version_name,
            logging_level=logging_level,
            max_workers=1,
            vrm_model=vrm_model,
            output_path=str(output_path),
            bone_pairs=bone_pairs or BONE_PAIRS,
            physics_pairs=physics_pairs or RIGIDBODY_PAIRS,
            monitor=None,
            is_file=False,
            outout_datetime="bytes",
        )

        result = Vrm2PmxExportService(options).execute()
        if not result or not output_path.exists():
            raise RuntimeError("conversion failed")

        return output_path.read_bytes()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
