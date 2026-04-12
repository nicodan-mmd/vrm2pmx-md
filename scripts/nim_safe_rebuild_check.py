#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_checked(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"command failed ({proc.returncode}): {' '.join(cmd)}")


def build_candidate(nim_source: Path, candidate_exe: Path) -> None:
    candidate_exe.parent.mkdir(parents=True, exist_ok=True)
    run_checked(["nim", "c", "-d:release", f"--out:{candidate_exe}", str(nim_source)])


def convert(exe_path: Path, model_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run_checked([str(exe_path), str(model_path), str(output_path)])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build Nim candidate exe safely and compare with reference output before replacement"
    )
    parser.add_argument("model_path", help="Input VRM/GLB path used for A/B verification")
    parser.add_argument("--nim-source", default="src/nim/pmx_lite_main.nim", help="Nim entry source")
    parser.add_argument("--reference-exe", default="src/nim/pmx_lite_main.exe", help="Existing trusted exe")
    parser.add_argument("--candidate-exe", default="tmp/nim/pmx_lite_main_candidate.exe", help="Temporary candidate exe")
    parser.add_argument(
        "--replace-reference",
        action="store_true",
        help="Replace reference exe only when candidate output is byte-identical to reference output",
    )
    parser.add_argument(
        "--report-json",
        default="tmp/nim/safe_rebuild_report.json",
        help="Path to write JSON report",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    model_path = Path(args.model_path)
    nim_source = Path(args.nim_source)
    reference_exe = Path(args.reference_exe)
    candidate_exe = Path(args.candidate_exe)
    report_json = Path(args.report_json)

    if not model_path.exists():
        print(f"ERROR: model not found: {model_path}")
        return 1
    if not nim_source.exists():
        print(f"ERROR: nim source not found: {nim_source}")
        return 1
    if not reference_exe.exists():
        print(f"ERROR: reference exe not found: {reference_exe}")
        return 1

    old_pmx = Path("tmp/nim/reference_output.pmx")
    new_pmx = Path("tmp/nim/candidate_output.pmx")

    try:
        build_candidate(nim_source, candidate_exe)
        convert(reference_exe, model_path, old_pmx)
        convert(candidate_exe, model_path, new_pmx)
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1

    reference_output_hash = sha256_file(old_pmx)
    candidate_output_hash = sha256_file(new_pmx)
    outputs_equal = reference_output_hash == candidate_output_hash

    report = {
        "model_path": str(model_path.resolve()),
        "nim_source": str(nim_source.resolve()),
        "reference_exe": str(reference_exe.resolve()),
        "candidate_exe": str(candidate_exe.resolve()),
        "reference_exe_sha256": sha256_file(reference_exe),
        "candidate_exe_sha256": sha256_file(candidate_exe),
        "reference_output": {
            "path": str(old_pmx.resolve()),
            "size_bytes": old_pmx.stat().st_size,
            "sha256": reference_output_hash,
        },
        "candidate_output": {
            "path": str(new_pmx.resolve()),
            "size_bytes": new_pmx.stat().st_size,
            "sha256": candidate_output_hash,
        },
        "outputs_equal": outputs_equal,
        "replaced_reference": False,
    }

    if args.replace_reference and outputs_equal:
        shutil.copy2(candidate_exe, reference_exe)
        report["replaced_reference"] = True

    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    return 0 if outputs_equal else 2


if __name__ == "__main__":
    raise SystemExit(main())
