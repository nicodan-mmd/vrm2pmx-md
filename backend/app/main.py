from __future__ import annotations

import base64
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import unquote_to_bytes

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

ROOT_DIR = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config.default_pairs import BONE_PAIRS, RIGIDBODY_PAIRS  # noqa: E402
from mmd.PmxReader import PmxReader  # noqa: E402
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
        "http://localhost:5180",
        "http://127.0.0.1:5180",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MLogger.initialize(level=MLogger.INFO, is_file=False)


def _resolve_nim_exe() -> Path:
    env_path = os.environ.get("VRM2PMX_NIM_EXE", "").strip()
    if env_path:
        return Path(env_path)
    return ROOT_DIR / "tmp" / "nim" / "pmx_lite_main.exe"


def _decode_data_uri(uri: str) -> tuple[bytes, str | None] | None:
    if not uri.startswith("data:"):
        return None

    try:
        header, payload = uri.split(",", 1)
    except ValueError:
        return None

    mime_type: str | None = None
    is_base64 = False
    meta = header[5:]
    if meta:
        parts = [p for p in meta.split(";") if p]
        if parts:
            if parts[-1].lower() == "base64":
                is_base64 = True
                parts = parts[:-1]
            if parts:
                mime_type = parts[0]

    if is_base64:
        try:
            return base64.b64decode(payload), mime_type
        except Exception:
            return None

    try:
        return unquote_to_bytes(payload), mime_type
    except Exception:
        return None


def _extract_glb_embedded_images(glb_path: Path) -> list[tuple[bytes, str | None]]:
    data = glb_path.read_bytes()
    if len(data) < 12 or data[:4] != b"glTF":
        return []

    json_chunk: bytes | None = None
    bin_chunk: bytes | None = None
    offset = 12
    data_len = len(data)

    while offset + 8 <= data_len:
        chunk_len = int.from_bytes(data[offset : offset + 4], "little", signed=False)
        chunk_type = int.from_bytes(
            data[offset + 4 : offset + 8], "little", signed=False
        )
        start = offset + 8
        end = start + chunk_len
        if end > data_len:
            break

        if chunk_type == 0x4E4F534A and json_chunk is None:  # JSON
            json_chunk = data[start:end]
        elif chunk_type == 0x004E4942 and bin_chunk is None:  # BIN
            bin_chunk = data[start:end]

        offset = end

    if not json_chunk:
        return []

    try:
        json_text = json_chunk.decode("utf-8", errors="ignore").rstrip("\x00").strip()
        gltf = json.loads(json_text)
    except Exception:
        return []

    images = gltf.get("images")
    buffer_views = gltf.get("bufferViews")
    if not isinstance(images, list):
        return []
    if not isinstance(buffer_views, list):
        buffer_views = []

    extracted: list[tuple[bytes, str | None]] = []
    for image in images:
        if not isinstance(image, dict):
            extracted.append((b"", None))
            continue

        mime_type = (
            image.get("mimeType") if isinstance(image.get("mimeType"), str) else None
        )
        blob = b""

        buffer_view_idx = image.get("bufferView")
        if (
            isinstance(buffer_view_idx, int)
            and 0 <= buffer_view_idx < len(buffer_views)
            and bin_chunk is not None
        ):
            bv = buffer_views[buffer_view_idx]
            if isinstance(bv, dict):
                start = int(bv.get("byteOffset", 0) or 0)
                length = int(bv.get("byteLength", 0) or 0)
                end = start + length
                if length > 0 and 0 <= start <= end <= len(bin_chunk):
                    blob = bin_chunk[start:end]
        else:
            uri = image.get("uri")
            if isinstance(uri, str) and uri.startswith("data:"):
                decoded = _decode_data_uri(uri)
                if decoded:
                    blob, decoded_mime = decoded
                    if not mime_type:
                        mime_type = decoded_mime

        extracted.append((blob, mime_type))

    return extracted


def _safe_rel_path(raw: str) -> Path | None:
    normalized = raw.replace("\\", "/").strip().lstrip("/")
    if not normalized:
        return None

    parts: list[str] = []
    for part in normalized.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            return None
        parts.append(part)

    if not parts:
        return None
    return Path(*parts)


def _build_white_bmp_bytes() -> bytes:
    return bytes(
        [
            0x42,
            0x4D,  # BM
            0x3A,
            0x00,
            0x00,
            0x00,  # file size = 58
            0x00,
            0x00,
            0x00,
            0x00,  # reserved
            0x36,
            0x00,
            0x00,
            0x00,  # pixel data offset = 54
            0x28,
            0x00,
            0x00,
            0x00,  # DIB header size = 40
            0x01,
            0x00,
            0x00,
            0x00,  # width = 1
            0x01,
            0x00,
            0x00,
            0x00,  # height = 1
            0x01,
            0x00,  # planes = 1
            0x18,
            0x00,  # bits per pixel = 24
            0x00,
            0x00,
            0x00,
            0x00,  # compression = BI_RGB
            0x04,
            0x00,
            0x00,
            0x00,  # image size = 4 (row padded to 4 bytes)
            0x13,
            0x0B,
            0x00,
            0x00,  # x ppm = 2835
            0x13,
            0x0B,
            0x00,
            0x00,  # y ppm = 2835
            0x00,
            0x00,
            0x00,
            0x00,  # colors used
            0x00,
            0x00,
            0x00,
            0x00,  # important colors
            0xFF,
            0xFF,
            0xFF,
            0x00,  # pixel (BGR white) + row padding
        ]
    )


def _build_white_png_bytes() -> bytes:
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZgE8AAAAASUVORK5CYII="
    )


def _build_placeholder_texture_bytes(path: Path) -> bytes:
    suffix = path.suffix.lower()
    if suffix == ".bmp":
        return _build_white_bmp_bytes()
    return _build_white_png_bytes()


def _materialize_nim_textures(
    input_path: Path, output_dir: Path, output_path: Path
) -> int:
    extracted_images = _extract_glb_embedded_images(input_path)
    if not extracted_images:
        return 0

    pmx_model = PmxReader(str(output_path), is_check=False).read_data()
    texture_refs = list(pmx_model.textures)
    written = 0

    image_targets: list[Path] = []
    for texture_ref in texture_refs:
        if not isinstance(texture_ref, str) or not texture_ref.strip():
            continue

        rel_path = _safe_rel_path(texture_ref)
        if rel_path is None:
            continue

        # Embedded GLB images are usually color/normal/etc. and are stored as
        # PNG/JPEG/WebP. Keep explicit BMP TOON entries out of this sequential mapping.
        if rel_path.suffix.lower() in {".bmp", ".spa", ".sph", ".dds", ".tga"}:
            continue

        image_targets.append(rel_path)

    image_index = 0
    for rel_path in image_targets:
        while (
            image_index < len(extracted_images) and not extracted_images[image_index][0]
        ):
            image_index += 1
        if image_index >= len(extracted_images):
            break

        blob, _mime_type = extracted_images[image_index]
        image_index += 1

        target = output_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
        written += 1

    # Some VRM models refer to custom toon textures that are not embedded in GLB.
    # Materialize neutral placeholders so preview shaders can sample valid images.
    for texture_ref in texture_refs:
        if not isinstance(texture_ref, str) or not texture_ref.strip():
            continue

        rel_path = _safe_rel_path(texture_ref)
        if rel_path is None:
            continue

        target = output_dir / rel_path
        if target.exists():
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(_build_placeholder_texture_bytes(rel_path))
        written += 1

    return written


def _copy_python_auxiliary_assets(
    input_path: Path,
    output_dir: Path,
    bone_pairs: dict[str, Any],
    physics_pairs: dict[str, Any],
) -> int:
    vrm_model = VrmReader(str(input_path), is_check=False).read_data()
    if not isinstance(vrm_model, VrmModel):
        return 0

    aux_dir = output_dir.parent / "python_aux"
    aux_dir.mkdir(parents=True, exist_ok=True)
    aux_pmx_path = aux_dir / "auxiliary.pmx"
    options = MExportOptions(
        version_name="web-poc-nim-aux",
        logging_level=MLogger.ERROR,
        max_workers=1,
        vrm_model=vrm_model,
        output_path=str(aux_pmx_path),
        bone_pairs=bone_pairs,
        physics_pairs=physics_pairs,
        monitor=None,
        is_file=False,
        outout_datetime="web",
    )

    result = Vrm2PmxExportService(options).execute()
    if not result:
        return 0

    copied = 0
    for file_path in aux_dir.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() == ".pmx":
            continue

        rel_path = file_path.relative_to(aux_dir)
        target = output_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file_path, target)
        copied += 1

    shutil.rmtree(aux_dir, ignore_errors=True)
    return copied


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
    mode: str | None = Form(default="backend"),
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
    requested_mode = (mode or "backend").strip().lower()
    if requested_mode not in {"backend", "nim"}:
        raise HTTPException(
            status_code=400, detail="mode must be either 'backend' or 'nim'"
        )

    try:
        with input_path.open("wb") as fh:
            while True:
                chunk = await vrm_file.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)

        if requested_mode == "nim":
            nim_exe = _resolve_nim_exe()
            if not nim_exe.exists():
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Nim converter executable was not found. "
                        "Set VRM2PMX_NIM_EXE or build tmp/nim/pmx_lite_main(.exe on Windows)"
                    ),
                )

            try:
                subprocess.run(
                    [str(nim_exe), str(input_path), str(output_path)],
                    check=True,
                    cwd=str(ROOT_DIR),
                )
            except subprocess.CalledProcessError as exc:
                raise HTTPException(
                    status_code=500, detail=f"Nim conversion failed: {exc}"
                ) from exc

            _copy_python_auxiliary_assets(
                input_path, output_dir, bone_pairs, physics_pairs
            )
            _materialize_nim_textures(input_path, output_dir, output_path)
        else:
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

        if not output_path.exists():
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
