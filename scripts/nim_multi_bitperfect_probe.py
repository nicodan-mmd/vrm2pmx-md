#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import subprocess  # nosec B404
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from nim_bitperfect_validation import build_report, run_python_baseline

BROWSER_PYTHON_VERSION_NAME = "1.5.3"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_command_capture(args: list[str]) -> dict[str, Any]:
    try:
        proc = subprocess.run(  # nosec B603
            args, capture_output=True, text=True, timeout=10
        )
        stdout_lines = [
            line for line in (proc.stdout or "").splitlines() if line.strip()
        ]
        stderr_lines = [
            line for line in (proc.stderr or "").splitlines() if line.strip()
        ]
        return {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout_first_line": stdout_lines[0] if stdout_lines else "",
            "stderr_first_line": stderr_lines[0] if stderr_lines else "",
        }
    except Exception as exc:
        return {
            "ok": False,
            "returncode": None,
            "stdout_first_line": "",
            "stderr_first_line": str(exc),
        }


def collect_nim_environment(nim_exe: Path) -> dict[str, Any]:
    exe_version = run_command_capture([str(nim_exe), "--version"])
    compiler_version = run_command_capture(["nim", "--version"])

    return {
        "nim_exe_path": str(nim_exe.resolve()),
        "nim_exe_sha256": sha256_file(nim_exe),
        "nim_exe_size_bytes": nim_exe.stat().st_size,
        "nim_exe_version_probe": exe_version,
        "nim_compiler_version_probe": compiler_version,
    }


def verify_nim_lock(expected: dict[str, Any], actual: dict[str, Any]) -> list[str]:
    mismatches: list[str] = []

    expected_exe_hash = str(expected.get("nim_exe_sha256", "")).strip().lower()
    if expected_exe_hash:
        actual_exe_hash = str(actual.get("nim_exe_sha256", "")).strip().lower()
        if actual_exe_hash != expected_exe_hash:
            mismatches.append("nim_exe_sha256 mismatch")

    expected_compiler_line = str(expected.get("nim_compiler_version_line", "")).strip()
    if expected_compiler_line:
        actual_compiler_line = str(
            actual.get("nim_compiler_version_probe", {}).get("stdout_first_line", "")
        ).strip()
        if actual_compiler_line != expected_compiler_line:
            mismatches.append("nim_compiler_version_line mismatch")

    return mismatches


def write_markdown_summary(output_md: Path, payload: dict[str, Any]) -> None:
    summary = payload["summary"]
    results = payload["results"]

    lines: list[str] = [
        f"# VRoid Multi-Model Bitperfect Probe Summary ({datetime.now().strftime('%Y-%m-%d')})",
        "",
        f"- Search path: {payload['search_path']}",
        f"- Mode: {payload.get('mode', 'nim-exe')}",
        f"- Target: {payload.get('target_path', payload.get('nim_exe', ''))}",
        f"- Excluded from bit-perfect target: {payload.get('exclude_bitperfect_path', [])}",
        f"- Total: {summary['total']}",
        f"- Preview OK: {summary['preview_ok']}",
        f"- Preview Errors: {summary['errors']}",
        f"- Bit-perfect target models: {summary['bitperfect_target_models']}",
        f"- Bit-perfect (target only): {summary['bit_perfect']}",
        f"- Non bit-perfect (target only): {summary['non_bit_perfect']}",
        f"- Excluded models (preview-only policy): {summary['excluded_models']}",
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
        "| Model | RelativePath | Status | Target | BitPerfect | first_diff | size_delta | section |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
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
            size_delta = int(comparison.get("nim_size_bytes", 0)) - int(
                comparison.get("baseline_size_bytes", 0)
            )

        location = item.get("first_diff_location", {})
        section = location.get("section", "")
        bit_perfect = "yes" if comparison.get("bit_perfect") else "no"
        status = str(comparison.get("status", "unknown"))
        target = "no" if item.get("bitperfect_excluded") else "yes"

        lines.append(
            f"| {item['model']} | {relative_path} | {status} | {target} | {bit_perfect} | {first_diff} | {size_delta} | {section} |"
        )

    output_md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def find_vrm_files(search_root: Path, max_count: int) -> list[Path]:
    results: list[Path] = []
    for vrm_path in search_root.rglob("*.vrm"):
        results.append(vrm_path)
        if len(results) >= max_count:
            break
    return results


def normalize_for_match(path_text: str) -> str:
    return path_text.replace("\\", "/").lower()


def is_bitperfect_excluded(vrm_path: Path, patterns: list[str]) -> bool:
    if not patterns:
        return False
    target = normalize_for_match(str(vrm_path))
    for pattern in patterns:
        if not pattern:
            continue
        if normalize_for_match(pattern) in target:
            return True
    return False


def run_wasm_dump(
    vrm_path: Path,
    wasm_path: Path,
    wasm_runner: Path,
    output_path: Path,
    version_name: str,
) -> None:
    proc = subprocess.run(  # nosec
        [
            "node",
            str(wasm_runner),
            "--vrm",
            str(vrm_path),
            "--wasm",
            str(wasm_path),
            "--out",
            str(output_path),
            "--version",
            version_name,
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"wasm runner failed (rc={proc.returncode}): {detail[:300]}")

    raw = (proc.stdout or "").strip().splitlines()
    if not raw:
        raise RuntimeError("wasm runner returned empty output")

    try:
        payload = json.loads(raw[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"wasm runner output parse error: {exc}") from exc

    if payload.get("status") != "ok":
        raise RuntimeError(f"wasm runner error: {payload.get('error', 'unknown')}")

    if not output_path.exists():
        raise RuntimeError(f"wasm output missing: {output_path}")


def read_idx(data: bytes, offset: int, size: int) -> tuple[int, int]:
    if size == 1:
        return struct.unpack_from("<b", data, offset)[0], offset + 1
    if size == 2:
        return struct.unpack_from("<h", data, offset)[0], offset + 2
    return struct.unpack_from("<i", data, offset)[0], offset + 4


def read_text(data: bytes, offset: int) -> tuple[int, int]:
    text_len = struct.unpack_from("<i", data, offset)[0]
    return text_len, offset + 4 + text_len


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
    if len(header) < 8:
        return {"section": "unknown", "reason": "header_too_short"}

    additional_uv_count = int(header[1])
    vertex_index_size = int(header[2])
    texture_index_size = int(header[3])
    bone_index_size = int(header[5])
    morph_index_size = int(header[6])
    rigidbody_index_size = int(header[7])

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
        if additional_uv_count > 0:
            offset += 16 * additional_uv_count
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

    if first_diff < offset + 4:
        return {"section": "index_count"}
    index_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    index_region_end = offset + (index_count * vertex_index_size)
    if offset <= first_diff < index_region_end:
        rel = first_diff - offset
        return {
            "section": "index",
            "index_size": vertex_index_size,
            "index_pos": rel // max(1, vertex_index_size),
        }
    offset = index_region_end

    if first_diff < offset + 4:
        return {"section": "texture_count"}
    texture_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    for texture_idx in range(texture_count):
        if first_diff < offset + 4:
            return {
                "section": "texture",
                "texture_index": texture_idx,
                "field": "length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {"section": "texture", "texture_index": texture_idx, "field": "path"}
        offset = next_offset

    if first_diff < offset + 4:
        return {"section": "material_count"}
    material_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    for material_idx in range(material_count):
        if first_diff < offset + 4:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "name",
            }
        offset = next_offset

        if first_diff < offset + 4:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "english_name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "english_name",
            }
        offset = next_offset

        fixed_len = 65
        if offset <= first_diff < offset + fixed_len:
            rel = first_diff - offset
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "fixed_block",
                "fixed_rel_offset": rel,
            }
        offset += fixed_len

        if first_diff < offset + texture_index_size:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "texture_index",
            }
        offset += texture_index_size
        if first_diff < offset + texture_index_size:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "sphere_texture_index",
            }
        offset += texture_index_size
        if first_diff < offset + 1:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "sphere_mode",
            }
        sphere_mode = data[offset]
        offset += 1
        if first_diff < offset + 1:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "toon_sharing_flag",
            }
        toon_flag = data[offset]
        offset += 1

        toon_size = texture_index_size if toon_flag == 0 else 1
        if first_diff < offset + toon_size:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "toon_texture_index",
                "toon_sharing_flag": toon_flag,
                "sphere_mode": sphere_mode,
            }
        offset += toon_size

        if first_diff < offset + 4:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "comment_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "comment",
            }
        offset = next_offset

        if first_diff < offset + 4:
            return {
                "section": "material",
                "material_index": material_idx,
                "field": "vertex_count",
            }
        offset += 4

    if first_diff < offset + 4:
        return {"section": "bone_count"}
    bone_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    for bone_idx in range(bone_count):
        if first_diff < offset + 4:
            return {"section": "bone", "bone_index": bone_idx, "field": "name_length"}
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {"section": "bone", "bone_index": bone_idx, "field": "name"}
        offset = next_offset

        if first_diff < offset + 4:
            return {
                "section": "bone",
                "bone_index": bone_idx,
                "field": "english_name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {"section": "bone", "bone_index": bone_idx, "field": "english_name"}
        offset = next_offset

        if offset <= first_diff < offset + 12:
            return {"section": "bone", "bone_index": bone_idx, "field": "position"}
        offset += 12
        if offset <= first_diff < offset + bone_index_size:
            return {"section": "bone", "bone_index": bone_idx, "field": "parent_index"}
        _, offset = read_idx(data, offset, bone_index_size)
        if offset <= first_diff < offset + 4:
            return {"section": "bone", "bone_index": bone_idx, "field": "layer"}
        offset += 4
        if offset <= first_diff < offset + 2:
            return {"section": "bone", "bone_index": bone_idx, "field": "flag"}
        flag = struct.unpack_from("<h", data, offset)[0]
        offset += 2

        if (flag & 0x0001) != 0:
            if offset <= first_diff < offset + bone_index_size:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "tail_index",
                }
            _, offset = read_idx(data, offset, bone_index_size)
        else:
            if offset <= first_diff < offset + 12:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "tail_position",
                }
            offset += 12

        if (flag & 0x0300) != 0:
            if offset <= first_diff < offset + bone_index_size:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "append_bone_index",
                }
            _, offset = read_idx(data, offset, bone_index_size)
            if offset <= first_diff < offset + 4:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "append_ratio",
                }
            offset += 4

        if (flag & 0x0400) != 0:
            if offset <= first_diff < offset + 12:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "fixed_axis",
                }
            offset += 12

        if (flag & 0x0800) != 0:
            if offset <= first_diff < offset + 24:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "local_axis",
                }
            offset += 24

        if (flag & 0x2000) != 0:
            if offset <= first_diff < offset + 4:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "external_key",
                }
            offset += 4

        if (flag & 0x0020) != 0:
            if offset <= first_diff < offset + bone_index_size:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "ik_target_index",
                }
            _, offset = read_idx(data, offset, bone_index_size)
            if offset <= first_diff < offset + 4:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "ik_loop_count",
                }
            offset += 4
            if offset <= first_diff < offset + 4:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "ik_limit_radian",
                }
            offset += 4
            if offset <= first_diff < offset + 4:
                return {
                    "section": "bone",
                    "bone_index": bone_idx,
                    "field": "ik_link_count",
                }
            ik_link_count = struct.unpack_from("<i", data, offset)[0]
            offset += 4
            for link_idx in range(ik_link_count):
                if offset <= first_diff < offset + bone_index_size:
                    return {
                        "section": "bone",
                        "bone_index": bone_idx,
                        "field": "ik_link_bone_index",
                        "ik_link": link_idx,
                    }
                _, offset = read_idx(data, offset, bone_index_size)
                if offset <= first_diff < offset + 1:
                    return {
                        "section": "bone",
                        "bone_index": bone_idx,
                        "field": "ik_link_limit_angle",
                        "ik_link": link_idx,
                    }
                limit_angle = data[offset]
                offset += 1
                if limit_angle != 0:
                    if offset <= first_diff < offset + 24:
                        return {
                            "section": "bone",
                            "bone_index": bone_idx,
                            "field": "ik_link_limit",
                            "ik_link": link_idx,
                        }
                    offset += 24

    if first_diff < offset + 4:
        return {"section": "morph_count"}
    morph_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    for morph_idx in range(morph_count):
        if first_diff < offset + 4:
            return {
                "section": "morph",
                "morph_index": morph_idx,
                "field": "name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {"section": "morph", "morph_index": morph_idx, "field": "name"}
        offset = next_offset
        if first_diff < offset + 4:
            return {
                "section": "morph",
                "morph_index": morph_idx,
                "field": "english_name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {
                "section": "morph",
                "morph_index": morph_idx,
                "field": "english_name",
            }
        offset = next_offset
        if offset <= first_diff < offset + 2:
            return {
                "section": "morph",
                "morph_index": morph_idx,
                "field": "panel_or_type",
            }
        panel = data[offset]
        morph_type = data[offset + 1]
        offset += 2
        if offset <= first_diff < offset + 4:
            return {
                "section": "morph",
                "morph_index": morph_idx,
                "field": "offset_count",
            }
        morph_offset_count = struct.unpack_from("<i", data, offset)[0]
        offset += 4
        if morph_type == 1:
            unit = vertex_index_size + 12
            if offset <= first_diff < offset + (morph_offset_count * unit):
                rel = first_diff - offset
                return {
                    "section": "morph",
                    "morph_index": morph_idx,
                    "field": "vertex_offset",
                    "offset_index": rel // max(1, unit),
                }
            offset += morph_offset_count * unit
        else:
            unit = morph_index_size + 4
            if offset <= first_diff < offset + (morph_offset_count * unit):
                rel = first_diff - offset
                return {
                    "section": "morph",
                    "morph_index": morph_idx,
                    "field": "group_offset",
                    "offset_index": rel // max(1, unit),
                    "panel": panel,
                }
            offset += morph_offset_count * unit

    if first_diff < offset + 4:
        return {"section": "display_slot_count"}
    display_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    for display_idx in range(display_count):
        if first_diff < offset + 4:
            return {
                "section": "display_slot",
                "display_index": display_idx,
                "field": "name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {
                "section": "display_slot",
                "display_index": display_idx,
                "field": "name",
            }
        offset = next_offset
        if first_diff < offset + 4:
            return {
                "section": "display_slot",
                "display_index": display_idx,
                "field": "english_name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {
                "section": "display_slot",
                "display_index": display_idx,
                "field": "english_name",
            }
        offset = next_offset
        if offset <= first_diff < offset + 1:
            return {
                "section": "display_slot",
                "display_index": display_idx,
                "field": "special_flag",
            }
        offset += 1
        if offset <= first_diff < offset + 4:
            return {
                "section": "display_slot",
                "display_index": display_idx,
                "field": "ref_count",
            }
        ref_count = struct.unpack_from("<i", data, offset)[0]
        offset += 4
        for ref_idx in range(ref_count):
            if offset <= first_diff < offset + 1:
                return {
                    "section": "display_slot",
                    "display_index": display_idx,
                    "field": "ref_target_type",
                    "ref_index": ref_idx,
                }
            target_type = data[offset]
            offset += 1
            ref_size = bone_index_size if target_type == 0 else morph_index_size
            if offset <= first_diff < offset + ref_size:
                return {
                    "section": "display_slot",
                    "display_index": display_idx,
                    "field": "ref_index",
                    "ref_target_type": target_type,
                    "ref_pos": ref_idx,
                }
            offset += ref_size

    if first_diff < offset + 4:
        return {"section": "rigidbody_count"}
    rigid_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    for rigid_idx in range(rigid_count):
        if first_diff < offset + 4:
            return {
                "section": "rigidbody",
                "rigid_index": rigid_idx,
                "field": "name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {"section": "rigidbody", "rigid_index": rigid_idx, "field": "name"}
        offset = next_offset
        if first_diff < offset + 4:
            return {
                "section": "rigidbody",
                "rigid_index": rigid_idx,
                "field": "english_name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {
                "section": "rigidbody",
                "rigid_index": rigid_idx,
                "field": "english_name",
            }
        offset = next_offset
        rigid_fixed = bone_index_size + 1 + 2 + 1 + 12 + 12 + 12 + 20 + 1
        if offset <= first_diff < offset + rigid_fixed:
            return {
                "section": "rigidbody",
                "rigid_index": rigid_idx,
                "field": "payload",
            }
        offset += rigid_fixed

    if first_diff < offset + 4:
        return {"section": "joint_count"}
    joint_count = struct.unpack_from("<i", data, offset)[0]
    offset += 4
    for joint_idx in range(joint_count):
        if first_diff < offset + 4:
            return {
                "section": "joint",
                "joint_index": joint_idx,
                "field": "name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {"section": "joint", "joint_index": joint_idx, "field": "name"}
        offset = next_offset
        if first_diff < offset + 4:
            return {
                "section": "joint",
                "joint_index": joint_idx,
                "field": "english_name_length",
            }
        text_len, next_offset = read_text(data, offset)
        if offset + 4 <= first_diff < offset + 4 + text_len:
            return {
                "section": "joint",
                "joint_index": joint_idx,
                "field": "english_name",
            }
        offset = next_offset
        joint_fixed = 1 + (2 * rigidbody_index_size) + (6 * 12)
        if offset <= first_diff < offset + joint_fixed:
            return {"section": "joint", "joint_index": joint_idx, "field": "payload"}
        offset += joint_fixed

    return {"section": "after_joint", "offset": first_diff}


def probe_model(
    vrm_path: Path,
    mode: str,
    work_dir: Path,
    nim_exe: Path | None,
    wasm_path: Path | None,
    wasm_runner: Path | None,
    exclude_bitperfect_path: list[str],
) -> dict[str, Any]:
    baseline_version_name = (
        BROWSER_PYTHON_VERSION_NAME if mode == "wasm" else "nim-bitperfect-baseline"
    )
    nim_pmx_path = work_dir / f"{vrm_path.stem}_nim.pmx"
    if mode == "nim-exe":
        if nim_exe is None:
            raise RuntimeError("nim_exe is required for nim-exe mode")
        subprocess.run(  # nosec B603
            [str(nim_exe), str(vrm_path), str(nim_pmx_path)], check=True
        )
    else:
        if wasm_path is None or wasm_runner is None:
            raise RuntimeError("wasm_path/wasm_runner are required for wasm mode")
        run_wasm_dump(
            vrm_path, wasm_path, wasm_runner, nim_pmx_path, baseline_version_name
        )

    baseline_bytes, baseline_runs = run_python_baseline(
        vrm_path, 1, version_name=baseline_version_name
    )
    report = build_report(vrm_path, baseline_bytes, baseline_runs, nim_pmx_path)
    comparison = report.get("nim_comparison", {})

    result: dict[str, Any] = {
        "model": vrm_path.stem,
        "path": str(vrm_path),
        "nim_comparison": comparison,
        "bitperfect_excluded": is_bitperfect_excluded(
            vrm_path, exclude_bitperfect_path
        ),
    }

    if isinstance(comparison, dict) and comparison.get("status") == "ok":
        first_diff = int(comparison.get("first_diff_offset", -1))
        result["first_diff_location"] = locate_first_diff(baseline_bytes, first_diff)

    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Probe first diff patterns across multiple VRM models"
    )
    parser.add_argument("search_path", help="Root directory to search for VRM files")
    parser.add_argument(
        "--mode",
        choices=["nim-exe", "wasm"],
        default="nim-exe",
        help="Probe target mode",
    )
    parser.add_argument(
        "--nim-exe", default=None, help="Path to compiled Nim converter executable"
    )
    parser.add_argument(
        "--wasm",
        default="frontend/public/nim/vrm2pmx_nim_runtime.wasm",
        help="Path to Nim Wasm binary",
    )
    parser.add_argument(
        "--wasm-runner",
        default="scripts/frontend_wasm_dump_runner.mjs",
        help="Node runner script for Wasm",
    )
    parser.add_argument(
        "--max-count", type=int, default=5, help="Maximum number of VRM files to probe"
    )
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
    parser.add_argument(
        "--exclude-bitperfect-path",
        action="append",
        default=[],
        help="Path substring to exclude from bit-perfect target (can be specified multiple times)",
    )
    parser.add_argument(
        "--nim-lock-file",
        default=None,
        help="Optional JSON lock file to verify Nim exe hash/compiler version",
    )
    parser.add_argument(
        "--write-nim-lock",
        default=None,
        help="Optional path to write current Nim lock JSON",
    )
    parser.add_argument(
        "--enforce-nim-lock",
        action="store_true",
        help="Fail with exit code 3 when --nim-lock-file mismatch is detected",
    )
    args = parser.parse_args()

    search_root = Path(args.search_path)
    mode = args.mode

    nim_exe: Path | None = None
    wasm_path: Path | None = None
    wasm_runner: Path | None = None
    nim_env: dict[str, Any] = {}

    if mode == "nim-exe":
        if not args.nim_exe:
            print("--nim-exe is required when --mode nim-exe")
            return 1
        nim_exe = Path(args.nim_exe)
        if not nim_exe.exists():
            print(f"Nim exe not found: {nim_exe}")
            return 1
        nim_env = collect_nim_environment(nim_exe)
    else:
        wasm_path = Path(args.wasm)
        wasm_runner = Path(args.wasm_runner)
        if not wasm_path.exists():
            print(f"Wasm not found: {wasm_path}")
            return 1
        if not wasm_runner.exists():
            print(f"Wasm runner not found: {wasm_runner}")
            return 1
        nim_env = {
            "mode": "wasm",
            "wasm_path": str(wasm_path.resolve()),
            "wasm_sha256": sha256_file(wasm_path),
            "wasm_size_bytes": wasm_path.stat().st_size,
            "node_version_probe": run_command_capture(["node", "--version"]),
        }

    if args.write_nim_lock and mode == "nim-exe":
        lock_out = Path(args.write_nim_lock)
        lock_out.parent.mkdir(parents=True, exist_ok=True)
        lock_payload = {
            "nim_exe_sha256": nim_env["nim_exe_sha256"],
            "nim_compiler_version_line": nim_env.get(
                "nim_compiler_version_probe", {}
            ).get("stdout_first_line", ""),
            "nim_exe_path": nim_env["nim_exe_path"],
        }
        lock_out.write_text(
            json.dumps(lock_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    lock_result: dict[str, Any] = {
        "checked": False,
        "ok": True,
        "mismatches": [],
    }
    if args.nim_lock_file and mode == "nim-exe":
        lock_file = Path(args.nim_lock_file)
        if not lock_file.exists():
            print(f"Nim lock file not found: {lock_file}")
            return 1
        expected_lock = json.loads(lock_file.read_text(encoding="utf-8"))
        mismatches = verify_nim_lock(expected_lock, nim_env)
        lock_result = {
            "checked": True,
            "ok": len(mismatches) == 0,
            "lock_file": str(lock_file),
            "mismatches": mismatches,
        }
        if mismatches:
            print("Nim lock mismatch detected:")
            for item in mismatches:
                print(f"  - {item}")
            if args.enforce_nim_lock:
                return 3

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
            results.append(
                probe_model(
                    vrm_path,
                    mode,
                    work_dir,
                    nim_exe,
                    wasm_path,
                    wasm_runner,
                    args.exclude_bitperfect_path,
                )
            )
        except Exception as exc:
            results.append(
                {
                    "model": vrm_path.stem,
                    "path": str(vrm_path),
                    "error": str(exc),
                }
            )

    preview_ok = sum(
        1 for item in results if item.get("nim_comparison", {}).get("status") == "ok"
    )
    target_items = [
        item
        for item in results
        if item.get("nim_comparison", {}).get("status") == "ok"
        and not item.get("bitperfect_excluded", False)
    ]
    excluded_items = [
        item
        for item in results
        if item.get("nim_comparison", {}).get("status") == "ok"
        and item.get("bitperfect_excluded", False)
    ]

    summary = {
        "total": len(results),
        "ok": sum(1 for item in results if "nim_comparison" in item),
        "preview_ok": preview_ok,
        "bitperfect_target_models": len(target_items),
        "excluded_models": len(excluded_items),
        "bit_perfect": sum(
            1
            for item in target_items
            if item.get("nim_comparison", {}).get("bit_perfect")
        ),
        "non_bit_perfect": sum(
            1
            for item in target_items
            if not item.get("nim_comparison", {}).get("bit_perfect")
        ),
        "errors": sum(1 for item in results if "error" in item),
        "vertex_weight0": sum(
            1
            for item in target_items
            if item.get("first_diff_location", {}).get("section") == "vertex"
            and item.get("first_diff_location", {}).get("field") == "weight0"
        ),
    }
    if summary["bitperfect_target_models"] > 0:
        summary["bit_perfect_ratio_percent"] = round(
            summary["bit_perfect"] / summary["bitperfect_target_models"] * 100, 1
        )
    else:
        summary["bit_perfect_ratio_percent"] = 0.0

    payload = {
        "search_path": str(search_root),
        "mode": mode,
        "target_path": str(nim_exe if mode == "nim-exe" else wasm_path),
        "exclude_bitperfect_path": args.exclude_bitperfect_path,
        "nim_exe": str(nim_exe) if nim_exe else None,
        "wasm": str(wasm_path) if wasm_path else None,
        "nim_environment": nim_env,
        "nim_lock_check": lock_result,
        "summary": summary,
        "results": results,
    }
    output_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
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
