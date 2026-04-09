#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from nim_bitperfect_validation import build_report, run_python_baseline


def write_markdown_summary(output_md: Path, payload: dict[str, Any]) -> None:
    summary = payload["summary"]
    results = payload["results"]

    lines: list[str] = [
        f"# VRoid Multi-Model Bitperfect Probe Summary ({datetime.now().strftime('%Y-%m-%d')})",
        "",
        f"- Search path: {payload['search_path']}",
        f"- Nim exe: {payload['nim_exe']}",
        f"- Total: {summary['total']}",
        f"- OK: {summary['ok']}",
        f"- Bit-perfect: {summary['bit_perfect']}",
        f"- Non bit-perfect: {summary['non_bit_perfect']}",
        f"- Errors: {summary['errors']}",
        f"- Bit-perfect ratio: {summary['bit_perfect_ratio_percent']}%",
        "",
    ]

    error_rows = [item for item in results if "error" in item]
    if error_rows:
        lines += ["## Errors", ""]
        for item in error_rows:
            lines.append(f"- {item['model']}: {item['path']} / {item['error']}")
        lines.append("")

    lines += [
        "## Per Model Results",
        "",
        "| Model | RelativePath | Status | BitPerfect | first_diff | size_delta | section |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]

    search_root = Path(payload["search_path"])
    for item in results:
        full_path = Path(item["path"])
        try:
            relative_path = str(full_path.relative_to(search_root))
        except ValueError:
            relative_path = str(full_path)

        if "error" in item:
            lines.append(f"| {item['model']} | {relative_path} | error | | | | error |")
            continue

        comparison = item.get("nim_comparison", {})
        first_diff = comparison.get("first_diff_offset", "")
        size_delta = ""
        if comparison.get("status") == "ok":
            size_delta = int(comparison.get("nim_size_bytes", 0)) - int(comparison.get("baseline_size_bytes", 0))

        location = item.get("first_diff_location", {})
        section = location.get("section", "")
        bit_perfect = "yes" if comparison.get("bit_perfect") else "no"
        status = str(comparison.get("status", "unknown"))

        lines.append(
            f"| {item['model']} | {relative_path} | {status} | {bit_perfect} | {first_diff} | {size_delta} | {section} |"
        )

    output_md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def find_vrm_files(search_root: Path, max_count: int) -> list[Path]:
    results: list[Path] = []
    for vrm_path in search_root.rglob("*.vrm"):
        results.append(vrm_path)
        if len(results) >= max_count:
            break
    return results


def read_idx(data: bytes, offset: int, size: int) -> tuple[int, int]:
    if size == 1:
        return struct.unpack_from("<b", data, offset)[0], offset + 1
    if size == 2:
        return struct.unpack_from("<h", data, offset)[0], offset + 2
    return struct.unpack_from("<i", data, offset)[0], offset + 4


def locate_first_diff(data: bytes, first_diff: int) -> dict[str, Any]:
    if first_diff < 0:
        return {"section": "none"}

    offset = 0
    if first_diff < 4:
        return {"section": "signature"}
    if first_diff < 8:
        return {"section": "version"}
    offset += 8
    header_size = data[offset]
    if first_diff == offset:
        return {"section": "header_size"}
    offset += 1
    header = data[offset : offset + header_size]
    if offset <= first_diff < offset + header_size:
        return {"section": "header_bytes", "header_offset": first_diff - offset}
    offset += header_size
    if len(header) < 6:
        return {"section": "unknown", "reason": "header_too_short"}

    bone_index_size = header[5]

    text_fields = ["model_name_ja", "model_name_en", "comment_ja", "comment_en"]
    for field_name in text_fields:
        if first_diff < offset + 4:
            return {"section": field_name + "_length"}
        text_len = struct.unpack_from("<i", data, offset)[0]
        offset += 4
        if offset <= first_diff < offset + text_len:
            return {"section": field_name}
        offset += text_len

    if first_diff < offset + 4:
        return {"section": "vertex_count"}
    vertex_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    vertex_start = offset

    for vertex_index in range(vertex_count):
        start = offset
        position_offset = offset
        offset += 12
        normal_offset = offset
        offset += 12
        uv_offset = offset
        offset += 8
        deform_type_offset = offset
        deform_type = data[offset]
        offset += 1

        field_ranges: list[tuple[str, int, int]] = [
            ("position", position_offset, position_offset + 12),
            ("normal", normal_offset, normal_offset + 12),
            ("uv", uv_offset, uv_offset + 8),
            ("deform_type", deform_type_offset, deform_type_offset + 1),
        ]

        if deform_type == 0:
            _, offset = read_idx(data, offset, bone_index_size)
        elif deform_type == 1:
            _, offset = read_idx(data, offset, bone_index_size)
            _, offset = read_idx(data, offset, bone_index_size)
            field_ranges.append(("weight0", offset, offset + 4))
            offset += 4
        elif deform_type in (2, 4):
            for _ in range(4):
                _, offset = read_idx(data, offset, bone_index_size)
            field_ranges.append(("weight0", offset, offset + 4))
            offset += 4
            field_ranges.append(("weight1", offset, offset + 4))
            offset += 4
            field_ranges.append(("weight2", offset, offset + 4))
            offset += 4
            field_ranges.append(("weight3", offset, offset + 4))
            offset += 4
            if deform_type == 4:
                offset += 36
        elif deform_type == 3:
            _, offset = read_idx(data, offset, bone_index_size)
            _, offset = read_idx(data, offset, bone_index_size)
            field_ranges.append(("weight0", offset, offset + 4))
            offset += 4
            offset += 36
        else:
            return {
                "section": "vertex",
                "vertex_index": vertex_index,
                "deform_type": deform_type,
                "field": "unknown_deform_type",
            }

        edge_offset = offset
        field_ranges.append(("edge", edge_offset, edge_offset + 4))
        offset += 4
        end = offset

        if start <= first_diff < end:
            field_name = "unknown"
            for name, field_start, field_end in field_ranges:
                if field_start <= first_diff < field_end:
                    field_name = name
                    break
            return {
                "section": "vertex",
                "vertex_index": vertex_index,
                "deform_type": deform_type,
                "field": field_name,
                "vertex_range": [start, end],
            }

    if vertex_start <= first_diff < offset:
        return {"section": "vertex", "field": "unresolved"}
    return {"section": "after_vertex", "offset": first_diff}


def probe_model(vrm_path: Path, nim_exe: Path, work_dir: Path) -> dict[str, Any]:
    nim_pmx_path = work_dir / f"{vrm_path.stem}_nim.pmx"
    subprocess.run([str(nim_exe), str(vrm_path), str(nim_pmx_path)], check=True)

    baseline_bytes, baseline_runs = run_python_baseline(vrm_path, 1)
    report = build_report(vrm_path, baseline_bytes, baseline_runs, nim_pmx_path)
    comparison = report.get("nim_comparison", {})

    result: dict[str, Any] = {
        "model": vrm_path.stem,
        "path": str(vrm_path),
        "nim_comparison": comparison,
    }

    if isinstance(comparison, dict) and comparison.get("status") == "ok":
        first_diff = int(comparison.get("first_diff_offset", -1))
        result["first_diff_location"] = locate_first_diff(baseline_bytes, first_diff)

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe first diff patterns across multiple VRM models")
    parser.add_argument("search_path", help="Root directory to search for VRM files")
    parser.add_argument("--nim-exe", required=True, help="Path to compiled Nim converter executable")
    parser.add_argument("--max-count", type=int, default=5, help="Maximum number of VRM files to probe")
    parser.add_argument(
        "--output-json",
        default="tmp/multi_model_validation/nim_firstdiff_probe.json",
        help="Where to write JSON output",
    )
    parser.add_argument(
        "--output-md",
        default=None,
        help="Optional markdown summary path",
    )
    args = parser.parse_args()

    search_root = Path(args.search_path)
    nim_exe = Path(args.nim_exe)
    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    work_dir = Path("tmp") / "multi_model_validation" / "nim_probe_pmz"
    work_dir.mkdir(parents=True, exist_ok=True)

    vrm_paths = find_vrm_files(search_root, args.max_count)
    if not vrm_paths:
        print(f"No VRM files found under: {search_root}")
        return 1

    results: list[dict[str, Any]] = []
    for index, vrm_path in enumerate(vrm_paths, start=1):
        print(f"[{index}/{len(vrm_paths)}] {vrm_path.stem}")
        try:
            results.append(probe_model(vrm_path, nim_exe, work_dir))
        except Exception as exc:
            results.append(
                {
                    "model": vrm_path.stem,
                    "path": str(vrm_path),
                    "error": str(exc),
                }
            )

    summary = {
        "total": len(results),
        "ok": sum(1 for item in results if "nim_comparison" in item),
        "bit_perfect": sum(
            1
            for item in results
            if item.get("nim_comparison", {}).get("status") == "ok"
            and item.get("nim_comparison", {}).get("bit_perfect")
        ),
        "non_bit_perfect": sum(
            1
            for item in results
            if item.get("nim_comparison", {}).get("status") == "ok"
            and not item.get("nim_comparison", {}).get("bit_perfect")
        ),
        "errors": sum(1 for item in results if "error" in item),
        "vertex_weight0": sum(
            1
            for item in results
            if item.get("first_diff_location", {}).get("section") == "vertex"
            and item.get("first_diff_location", {}).get("field") == "weight0"
        ),
    }
    if summary["ok"] > 0:
        summary["bit_perfect_ratio_percent"] = round(summary["bit_perfect"] / summary["ok"] * 100, 1)
    else:
        summary["bit_perfect_ratio_percent"] = 0.0

    payload = {
        "search_path": str(search_root),
        "nim_exe": str(nim_exe),
        "summary": summary,
        "results": results,
    }
    output_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.output_md:
        output_md = Path(args.output_md)
        output_md.parent.mkdir(parents=True, exist_ok=True)
        write_markdown_summary(output_md, payload)
    print(f"Saved: {output_json}")
    if args.output_md:
        print(f"Saved: {args.output_md}")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())