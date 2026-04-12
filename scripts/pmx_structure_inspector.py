#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inspect PMX structure elements (bone/morph/rigidbody counts)."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path


def read_text(data: bytes, offset: int) -> tuple[str, int]:
    """Read PMX text (4-byte length + UTF-8 or UTF-16)."""
    if offset + 4 > len(data):
        return "", offset
    text_len = struct.unpack_from("<i", data, offset)[0]
    text_start = offset + 4
    text_end = text_start + text_len
    if text_end > len(data):
        return "", offset
    try:
        text = data[text_start:text_end].decode("utf-16-le")
    except:
        text = f"<binary:{text_len}bytes>"
    return text, text_end


def parse_pmx_structure(data: bytes) -> dict[str, object]:
    """Parse PMX header and count major sections."""
    if len(data) < 27:
        return {"error": "data too short"}

    # Header
    offset = 0
    signature = data[offset:offset+4]
    offset += 4

    if signature != b"PMX ":
        return {"error": "invalid signature"}

    version = struct.unpack_from("<f", data, offset)[0]
    offset += 4

    header_size = data[offset]
    offset += 1

    # Flags (8 bytes)
    flags = data[offset:offset+8]
    offset += 8

    texture_index_size = int(flags[2])
    material_index_size = int(flags[3])
    bone_index_size = int(flags[4])
    morph_index_size = int(flags[5])
    rigidbody_index_size = int(flags[6])

    # Model strings
    model_name, offset = read_text(data, offset)
    model_name_en, offset = read_text(data, offset)
    model_comment, offset = read_text(data, offset)
    model_comment_en, offset = read_text(data, offset)

    # Vertices
    vertex_count = struct.unpack_from("<I", data, offset)[0]
    offset += 4

    # Skip vertices
    for _ in range(min(vertex_count, 1)):  # Just skip first one for offset
        # position (12), normal (12), uv (8), deforming, edge factor (4)
        # deform can be 1/2/3/4 depending on type, weights (up to 16 bytes)
        # This is aproximate, real parsing is complex
        offset += 12 + 12 + 8  # position, normal, uv
        deform_type = data[offset]
        offset += 1
        if deform_type == 0:
            offset += bone_index_size
        elif deform_type == 1:
            offset += bone_index_size * 2 + 4
        elif deform_type in (2, 4):
            offset += bone_index_size * 4 + 16
        elif deform_type == 3:
            offset += bone_index_size * 2 + 4 + 36
        offset += 4  # edge factor

    # For simplicity, find where each section is by searching for count markers
    result = {
        "signature": signature.decode("ascii"),
        "version": version,
        "header_size": header_size,
        "model_name": model_name,
        "vertex_count": vertex_count,
    }

    # Search for section counts (4-byte little endian)
    # After vertices, indices, textures, materials come bones
    # Search forward for reasonable bone count (typically 50-200)
    found_sections = {}

    for search_offset in range(offset, min(offset + 100000, len(data) - 4)):
        count = struct.unpack_from("<I", data, search_offset)[0]
        if 30 < count < 300:  # Reasonable bone count
            found_sections[search_offset] = count

    result["search_results"] = found_sections
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect PMX structure")
    parser.add_argument("pmx_path", help="PMX file to inspect")
    args = parser.parse_args()

    path = Path(args.pmx_path)
    if not path.exists():
        print(f"ERROR: {path}")
        return 1

    data = path.read_bytes()
    result = parse_pmx_structure(data)

    print(f"PMX: {path.name}")
    print(f"  Signature: {result.get('signature')}")
    print(f"  Version: {result.get('version')}")
    print(f"  Model: {result.get('model_name')}")
    print(f"  Vertices: {result.get('vertex_count')}")
    print(f"  Size: {len(data)} bytes")

    if "search_results" in result:
        print(f"\nPossible section counts found:")
        for off, cnt in sorted(result["search_results"].items())[:10]:
            print(f"  offset {off} (0x{off:x}): {cnt} items")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
