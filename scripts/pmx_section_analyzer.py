#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Analyze PMX binary structure differences between two files."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path


def read_pmx_header(data: bytes) -> dict[str, object]:
    """Parse PMX header (first 8 bytes)."""
    if len(data) < 8:
        return {"error": "data too short for header"}

    signature = data[0:4]
    version = struct.unpack_from("<f", data, 4)[0]

    return {
        "signature": signature,
        "signature_hex": signature.hex(),
        "version": version,
        "valid": signature == b"PMX ",
    }


def read_pchar_count(data: bytes, offset: int) -> tuple[int, int]:
    """Read text length and advance offset."""
    if offset + 4 > len(data):
        return -1, offset
    text_len = struct.unpack_from("<i", data, offset)[0]
    return text_len, offset + 4


def analyze_sections(ref_path: Path, cand_path: Path) -> None:
    """Compare PMX sections byte-by-byte."""
    ref_data = ref_path.read_bytes()
    cand_data = cand_path.read_bytes()

    print(f"Reference PMX: {ref_path.name}")
    print(f"  Size: {len(ref_data)} bytes")
    print(f"  Header: {read_pmx_header(ref_data)}")
    print()

    print(f"Candidate PMX: {cand_path.name}")
    print(f"  Size: {len(cand_data)} bytes")
    print(f"  Header: {read_pmx_header(cand_data)}")
    print()

    # Find first difference
    diff_offset = -1
    for i in range(min(len(ref_data), len(cand_data))):
        if ref_data[i] != cand_data[i]:
            diff_offset = i
            break

    if diff_offset == -1:
        if len(ref_data) == len(cand_data):
            print("[OK] Files are identical.")
        else:
            diff_offset = min(len(ref_data), len(cand_data))

    print(f"First difference at offset: {diff_offset} (0x{diff_offset:x})")

    if diff_offset >= 0 and diff_offset < min(len(ref_data), len(cand_data)):
        ref_byte = ref_data[diff_offset]
        cand_byte = cand_data[diff_offset]
        print(f"  Reference: 0x{ref_byte:02x} ({ref_byte})")
        print(f"  Candidate: 0x{cand_byte:02x} ({cand_byte})")

        # Show context
        context_start = max(0, diff_offset - 16)
        context_end = min(len(ref_data), diff_offset + 32)
        ref_context = ref_data[context_start:context_end]
        cand_context = cand_data[context_start:context_end]

        print(f"\nContext around offset {diff_offset}:")
        print(f"  Reference: {ref_context.hex()}")
        print(f"  Candidate: {cand_context.hex()}")

    # Size delta
    print(f"\nSize delta: {len(cand_data) - len(ref_data)} bytes")
    size_ratio = len(cand_data) / len(ref_data) if len(ref_data) > 0 else 0
    print(f"Size ratio: {size_ratio:.2%}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze PMX binary structure differences"
    )
    parser.add_argument("reference", help="Reference PMX file")
    parser.add_argument("candidate", help="Candidate PMX file")
    args = parser.parse_args()

    ref_path = Path(args.reference)
    cand_path = Path(args.candidate)

    if not ref_path.exists():
        print(f"ERROR: reference not found: {ref_path}")
        return 1
    if not cand_path.exists():
        print(f"ERROR: candidate not found: {cand_path}")
        return 1

    analyze_sections(ref_path, cand_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
