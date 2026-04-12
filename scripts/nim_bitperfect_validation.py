#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bit-perfect validation helper for Nim conversion work.

This script establishes a deterministic Python baseline PMX and optionally
compares a Nim-generated PMX file against that baseline byte-by-byte.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from service.Vrm2PmxBytesService import convert_vrm_bytes
from utils.MLogger import MLogger


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def first_diff_offset(a: bytes, b: bytes) -> int:
    limit = min(len(a), len(b))
    for idx in range(limit):
        if a[idx] != b[idx]:
            return idx
    if len(a) != len(b):
        return limit
    return -1


def run_python_baseline(
    vrm_path: Path,
    runs: int,
    version_name: str = "nim-bitperfect-baseline",
) -> tuple[bytes, list[dict[str, object]]]:
    vrm_bytes = vrm_path.read_bytes()
    run_details: list[dict[str, object]] = []
    first_output: bytes | None = None

    for index in range(runs):
        started = time.perf_counter()
        pmx_bytes = convert_vrm_bytes(
            vrm_bytes,
            file_suffix=vrm_path.suffix.lower() or ".vrm",
            source_stem=vrm_path.stem,
            version_name=version_name,
            logging_level=MLogger.ERROR,
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        run_hash = sha256_hex(pmx_bytes)

        if first_output is None:
            first_output = pmx_bytes

        run_details.append(
            {
                "run": index + 1,
                "elapsed_ms": elapsed_ms,
                "size_bytes": len(pmx_bytes),
                "sha256": run_hash,
            }
        )

    if first_output is None:
        raise RuntimeError("failed to produce baseline output")

    return first_output, run_details


def build_report(
    vrm_path: Path,
    baseline_bytes: bytes,
    baseline_runs: list[dict[str, object]],
    nim_pmx_path: Path | None,
) -> dict[str, object]:
    baseline_hashes = [str(item["sha256"]) for item in baseline_runs]
    baseline_stable = len(set(baseline_hashes)) == 1
    baseline_hash = sha256_hex(baseline_bytes)

    report: dict[str, object] = {
        "vrm_path": str(vrm_path),
        "python_baseline": {
            "runs": len(baseline_runs),
            "stable": baseline_stable,
            "size_bytes": len(baseline_bytes),
            "sha256": baseline_hash,
            "run_details": baseline_runs,
        },
    }

    if nim_pmx_path is None:
        report["nim_comparison"] = {
            "status": "skipped",
            "reason": "nim_pmx_path not provided",
        }
        return report

    if not nim_pmx_path.exists():
        report["nim_comparison"] = {
            "status": "error",
            "reason": f"nim_pmx_path not found: {nim_pmx_path}",
        }
        return report

    nim_bytes = nim_pmx_path.read_bytes()
    nim_hash = sha256_hex(nim_bytes)
    offset = first_diff_offset(baseline_bytes, nim_bytes)
    bit_perfect = offset == -1

    comparison: dict[str, object] = {
        "status": "ok",
        "bit_perfect": bit_perfect,
        "baseline_size_bytes": len(baseline_bytes),
        "nim_size_bytes": len(nim_bytes),
        "baseline_sha256": baseline_hash,
        "nim_sha256": nim_hash,
        "first_diff_offset": offset,
    }

    if not bit_perfect and offset >= 0:
        baseline_byte = baseline_bytes[offset] if offset < len(baseline_bytes) else None
        nim_byte = nim_bytes[offset] if offset < len(nim_bytes) else None
        comparison["first_diff_baseline_byte"] = baseline_byte
        comparison["first_diff_nim_byte"] = nim_byte

    report["nim_comparison"] = comparison
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate bit-perfect PMX output")
    parser.add_argument("vrm_path", help="Input VRM/GLB path")
    parser.add_argument(
        "--nim-pmx",
        dest="nim_pmx",
        default=None,
        help="Path to Nim-generated PMX for byte-level comparison",
    )
    parser.add_argument(
        "--baseline-runs",
        dest="baseline_runs",
        type=int,
        default=3,
        help="Number of Python baseline runs (default: 3)",
    )
    parser.add_argument(
        "--output-json",
        dest="output_json",
        default=None,
        help="Optional output JSON path",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    vrm_path = Path(args.vrm_path)

    if not vrm_path.exists():
        print(f"ERROR: VRM not found: {vrm_path}")
        return 1

    if args.baseline_runs < 1:
        print("ERROR: --baseline-runs must be >= 1")
        return 1

    nim_pmx_path = Path(args.nim_pmx) if args.nim_pmx else None
    baseline_bytes, baseline_runs = run_python_baseline(vrm_path, args.baseline_runs)
    report = build_report(vrm_path, baseline_bytes, baseline_runs, nim_pmx_path)

    output_text = json.dumps(report, ensure_ascii=False, indent=2)
    print(output_text)

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output_text, encoding="utf-8")

    nim_info = report.get("nim_comparison", {})
    if isinstance(nim_info, dict) and nim_info.get("status") == "ok":
        return 0 if bool(nim_info.get("bit_perfect")) else 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())