from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

ROOT_DIR = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config.default_pairs import BONE_PAIRS, RIGIDBODY_PAIRS  # noqa: E402
from mmd.VrmData import VrmModel  # noqa: E402
from mmd.VrmReader import VrmReader  # noqa: E402
from module.MOptions import MExportOptions  # noqa: E402
from service.Vrm2PmxExportService import Vrm2PmxExportService  # noqa: E402
from utils.MLogger import MLogger  # noqa: E402

app = FastAPI(title="vrm2pmx web api", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MLogger.initialize(level=MLogger.INFO, is_file=False)


def _sanitize_output_stem(name: str | None) -> str:
    if not name:
        return "result"

    sanitized = "".join(ch for ch in name.strip() if ch not in '<>:"/\\|?*')
    sanitized = sanitized.strip(" .")
    return sanitized or "result"


def _create_result_zip(output_dir: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in output_dir.rglob("*"):
            if file_path.is_file():
                if file_path.resolve() == zip_path.resolve():
                    continue
                zf.write(file_path, arcname=file_path.relative_to(output_dir))


def _load_optional_dict(raw: str | None, fallback: dict[str, Any]) -> dict[str, Any]:
    if raw is None or raw.strip() == "":
        return copy.deepcopy(fallback)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc.msg}") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="JSON body must be an object")

    return parsed


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/convert")
async def convert(
    vrm_file: Annotated[UploadFile, File(...)],
    bone_config: str | None = Form(default=None),
    physics_config: str | None = Form(default=None),
):
    if not vrm_file.filename:
        raise HTTPException(status_code=400, detail="No file name provided")

    suffix = Path(vrm_file.filename).suffix.lower()
    if suffix not in {".vrm", ".glb"}:
        raise HTTPException(status_code=400, detail="Only .vrm or .glb is supported")

    bone_pairs = _load_optional_dict(bone_config, BONE_PAIRS)
    physics_pairs = _load_optional_dict(physics_config, RIGIDBODY_PAIRS)

    tmp_dir = Path(tempfile.mkdtemp(prefix="vrm2pmx_"))
    input_dir = tmp_dir / "input"
    output_dir = tmp_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    input_path = input_dir / f"source{suffix}"
    output_stem = _sanitize_output_stem(Path(vrm_file.filename).stem)
    output_path = output_dir / f"{output_stem}.pmx"

    try:
        with input_path.open("wb") as fh:
            while True:
                chunk = await vrm_file.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)

        vrm_model = VrmReader(str(input_path), is_check=False).read_data()
        if not isinstance(vrm_model, VrmModel):
            raise HTTPException(status_code=400, detail="Invalid VRM file")

        options = MExportOptions(
            version_name="web-poc",
            logging_level=MLogger.INFO,
            max_workers=1,
            vrm_model=vrm_model,
            output_path=str(output_path),
            bone_pairs=bone_pairs,
            physics_pairs=physics_pairs,
            monitor=None,
            is_file=False,
            outout_datetime="web",
        )

        result = Vrm2PmxExportService(options).execute()
        if not result or not output_path.exists():
            raise HTTPException(status_code=500, detail="Conversion failed")

        zip_path = tmp_dir / "result.zip"
        _create_result_zip(output_dir, zip_path)

        download_name = f"{Path(vrm_file.filename).stem}_pmx.zip"
        return FileResponse(
            str(zip_path),
            media_type="application/zip",
            filename=download_name,
            background=BackgroundTask(shutil.rmtree, tmp_dir, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.exception_handler(HTTPException)
async def http_error_handler(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
