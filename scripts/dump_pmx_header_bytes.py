#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
from pathlib import Path


def to_hex_line(data: bytes, start: int, width: int = 16) -> str:
    chunk = data[start : start + width]
    hex_part = " ".join(f"{b:02x}" for b in chunk)
    return f"{start:08x}: {hex_part}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Dump PMX header bytes")
    parser.add_argument("pmx_path")
    parser.add_argument("--bytes", type=int, default=96, dest="byte_count")
    args = parser.parse_args()

    pmx_path = Path(args.pmx_path)
    if not pmx_path.exists():
        print(f"ERROR: not found: {pmx_path}")
        return 1

    raw = pmx_path.read_bytes()
    limit = min(len(raw), args.byte_count)
    print(f"path={pmx_path}")
    print(f"size={len(raw)}")
    for offset in range(0, limit, 16):
      print(to_hex_line(raw, offset))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
