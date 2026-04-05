from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import json
import mimetypes
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path
from typing import Any


def build_multipart_body(
    file_path: Path, field_name: str = "vrm_file"
) -> tuple[bytes, str]:
    boundary = f"----vrm2pmx-boundary-{uuid.uuid4().hex}"
    mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    file_bytes = file_path.read_bytes()

    lines: list[bytes] = []
    lines.append(f"--{boundary}\r\n".encode("utf-8"))
    lines.append(
        (
            f'Content-Disposition: form-data; name="{field_name}"; '
            f'filename="{file_path.name}"\r\n'
        ).encode("utf-8")
    )
    lines.append(f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"))
    lines.append(file_bytes)
    lines.append("\r\n".encode("utf-8"))
    lines.append(f"--{boundary}--\r\n".encode("utf-8"))

    body = b"".join(lines)
    content_type = f"multipart/form-data; boundary={boundary}"
    return body, content_type


def post_convert(endpoint: str, file_path: Path) -> tuple[bytes, float]:
    parsed_endpoint = urllib.parse.urlparse(endpoint)
    if parsed_endpoint.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported endpoint scheme: {parsed_endpoint.scheme!r}")
    if not parsed_endpoint.netloc:
        raise ValueError(f"Endpoint host is missing: {endpoint!r}")

    body, content_type = build_multipart_body(file_path)
    target = parsed_endpoint.path or "/"
    if parsed_endpoint.query:
        target = f"{target}?{parsed_endpoint.query}"

    connection_cls = (
        http.client.HTTPSConnection
        if parsed_endpoint.scheme == "https"
        else http.client.HTTPConnection
    )
    conn = connection_cls(parsed_endpoint.netloc, timeout=600)

    started = time.perf_counter()
    try:
        conn.request("POST", target, body=body, headers={"Content-Type": content_type})
        resp = conn.getresponse()
        payload = resp.read()
        if resp.status >= 400:
            raise RuntimeError(f"Convert API failed: HTTP {resp.status} {resp.reason}")
    finally:
        conn.close()

    elapsed = time.perf_counter() - started
    return payload, elapsed


def summarize_zip(zip_path: Path) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            entries.append(
                {
                    "name": info.filename,
                    "file_size": info.file_size,
                    "compress_size": info.compress_size,
                }
            )

    return {
        "entry_count": len(entries),
        "entries": entries,
    }


def to_markdown(record: dict[str, Any]) -> str:
    runs = record["runs"]["python_sec"]
    summary = record["summary"]
    mode = record["mode"]
    artifact = record["artifact"]

    lines = [
        "# Backend Baseline Comparison Record",
        "",
        "## Meta",
        "",
        f"- Date: {record['date']}",
        f"- Branch: {record['branch']}",
        f"- Environment: {record['environment']}",
        f"- Input file: {record['input']['path']}",
        f"- Input size bytes: {record['input']['size_bytes']}",
        "",
        "## Timing",
        "",
        f"- Warmup runs: {record['runs']['warmup']}",
        f"- Measured runs: {record['runs']['measured']}",
        f"- Raw sec: {', '.join(f'{t:.3f}' for t in runs)}",
        f"- Avg sec: {summary['python_avg_sec']:.3f}",
        f"- Min sec: {summary['python_min_sec']:.3f}",
        f"- Max sec: {summary['python_max_sec']:.3f}",
        "",
        "## Mode",
        "",
        f"- Requested: {mode['requested']}",
        f"- Used: {mode['used']}",
        "",
        "## Artifact",
        "",
        f"- Zip path: {artifact['zip_path']}",
        f"- SHA256: {artifact['sha256']}",
        f"- Entry count: {artifact['zip_summary']['entry_count']}",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record backend baseline comparison for Rust migration"
    )
    parser.add_argument("--input", required=True, help="Path to input VRM/GLB file")
    parser.add_argument(
        "--endpoint",
        default="http://127.0.0.1:8000/api/convert",
        help="Backend convert endpoint",
    )
    parser.add_argument("--warmup", type=int, default=1, help="Number of warmup runs")
    parser.add_argument("--runs", type=int, default=3, help="Number of measured runs")
    parser.add_argument(
        "--sample", default="sample", help="Sample label for file naming"
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists() or not input_path.is_file():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    repo_root = Path(__file__).resolve().parents[1]
    comparisons_dir = repo_root / "docs" / "Rust-Conversion" / "Comparisons"
    records_dir = comparisons_dir / "records"
    artifacts_dir = comparisons_dir / "artifacts"
    records_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    for _ in range(max(args.warmup, 0)):
        post_convert(args.endpoint, input_path)

    measured: list[float] = []
    zip_bytes: bytes | None = None
    for _ in range(max(args.runs, 1)):
        payload, elapsed = post_convert(args.endpoint, input_path)
        measured.append(elapsed)
        if zip_bytes is None:
            zip_bytes = payload

    if zip_bytes is None:
        raise RuntimeError("Conversion did not return any payload")

    date_tag = dt.datetime.now().strftime("%Y%m%d")
    stem = f"{date_tag}_{args.sample}_backend_baseline"
    zip_rel_path = (
        Path("docs") / "Rust-Conversion" / "Comparisons" / "artifacts" / f"{stem}.zip"
    )
    zip_abs_path = repo_root / zip_rel_path
    zip_abs_path.write_bytes(zip_bytes)

    sha256 = hashlib.sha256(zip_bytes).hexdigest()
    zip_summary = summarize_zip(zip_abs_path)

    avg_sec = sum(measured) / len(measured)
    record: dict[str, Any] = {
        "date": dt.date.today().isoformat(),
        "commit": "working-tree",
        "branch": "main",
        "environment": "backend",
        "input": {
            "path": str(input_path).replace("\\", "/"),
            "size_bytes": input_path.stat().st_size,
        },
        "runs": {
            "warmup": max(args.warmup, 0),
            "measured": len(measured),
            "python_sec": [round(v, 6) for v in measured],
            "rust_requested_sec": [],
        },
        "summary": {
            "python_avg_sec": round(avg_sec, 6),
            "python_min_sec": round(min(measured), 6),
            "python_max_sec": round(max(measured), 6),
            "rust_avg_sec": 0,
            "rust_min_sec": 0,
            "rust_max_sec": 0,
            "delta_sec": 0,
        },
        "mode": {
            "requested": "python",
            "used": "backend",
            "fallback_reason": "",
        },
        "artifact": {
            "zip_path": str(zip_rel_path).replace("\\", "/"),
            "sha256": sha256,
            "zip_summary": zip_summary,
        },
        "mmd_equivalence": {
            "load_success": False,
            "visual_equivalent": False,
            "structural_equivalent": False,
            "notes": [
                "Pending external-app verification by user.",
            ],
        },
        "status": "warn",
        "next_action": "Ask user to verify loadability with external applications.",
    }

    json_path = records_dir / f"{stem}.json"
    md_path = records_dir / f"{stem}.md"
    json_path.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    md_path.write_text(to_markdown(record), encoding="utf-8")

    print(f"Saved: {json_path}")
    print(f"Saved: {md_path}")
    print(f"Saved: {zip_abs_path}")
    print(f"avg={avg_sec:.3f}s min={min(measured):.3f}s max={max(measured):.3f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
