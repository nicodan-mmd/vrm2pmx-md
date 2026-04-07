#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-model VRM conversion validation.
Automatically discovers VRM files and measures conversion metrics.
"""
import json
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).parent.parent / "frontend" / "public" / "py_src"))

from python_vrm_counters import run_python_conversion, extract_pmx_counts


def find_vrm_files(search_path: str, max_count: int = 10) -> list[str]:
    """Discover VRM files in directory."""
    search_root = Path(search_path)
    if not search_root.exists():
        return []

    vrm_files = []
    for vrm_file in search_root.rglob("*.vrm"):
        vrm_files.append(str(vrm_file))
        if len(vrm_files) >= max_count:
            break

    return vrm_files


def run_multiple_validations(vrm_paths: list[str], output_dir: str | None = None) -> dict:
    """Run validation on multiple VRM files."""
    results = {}

    output_dir_path = Path(output_dir) if output_dir else Path("tmp") / "multi_model_validation"
    output_dir_path.mkdir(parents=True, exist_ok=True)

    for idx, vrm_path in enumerate(vrm_paths, 1):
        vrm_name = Path(vrm_path).stem
        print(f"\n[{idx}/{len(vrm_paths)}] Processing: {vrm_name}")
        print("=" * 60)

        try:
            validation = run_python_conversion(vrm_path, num_runs=1)

            # Store results
            results[vrm_name] = {
                "path": vrm_path,
                "status": "ok",
                "counts": validation.runs[0].counts if validation.runs else {},
                "elapsed_ms": validation.runs[0].elapsed_ms if validation.runs else 0,
            }

            # Display results
            counts = results[vrm_name]["counts"]
            print(f"✓ Vertices: {counts.get('vertices', 0):6d}")
            print(f"  Faces:    {counts.get('faces', 0):6d}")
            print(f"  Bones:    {counts.get('bones', 0):6d}")
            print(f"  Morphs:   {counts.get('morphs', 0):6d}")
            print(f"  Materials:{counts.get('materials', 0):6d}")
            print(f"  Textures: {counts.get('textures', 0):6d}")
            print(f"  Time:     {results[vrm_name]['elapsed_ms']}ms")

        except Exception as e:
            print(f"✗ Error: {e}")
            results[vrm_name] = {
                "path": vrm_path,
                "status": "error",
                "error": str(e),
            }

    # Save results
    results_file = output_dir_path / f"validation_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    results_file.write_text(
        json.dumps(results, indent=2, ensure_ascii=False),
        encoding='utf-8'
    )

    print(f"\n\nResults saved to: {results_file}")

    # Summary
    successful = [r for r in results.values() if r["status"] == "ok"]
    print(f"\n=== Summary ===")
    print(f"Total models: {len(vrm_paths)}")
    print(f"Successful:   {len(successful)}")
    print(f"Failed:       {len(results) - len(successful)}")

    if successful:
        avg_time = sum(r["elapsed_ms"] for r in successful) / len(successful)
        print(f"Avg time:     {avg_time:.0f}ms")

    return results


def main():
    if len(sys.argv) < 2:
        print("Usage: python multi_model_validation.py <search_path> [--max-count N]")
        print("\nExamples:")
        print("  python multi_model_validation.py D:/VRoid")
        print("  python multi_model_validation.py D:/VRoid --max-count 5")
        sys.exit(1)

    search_path = sys.argv[1]
    max_count = 10

    if "--max-count" in sys.argv:
        idx = sys.argv.index("--max-count")
        if idx + 1 < len(sys.argv):
            max_count = int(sys.argv[idx + 1])

    print(f"VRM Multi-Model Validation")
    print(f"Search: {search_path}")
    print(f"Max count: {max_count}")
    print()

    vrm_files = find_vrm_files(search_path, max_count)

    if not vrm_files:
        print(f"No VRM files found in: {search_path}")
        sys.exit(1)

    print(f"Found {len(vrm_files)} VRM file(s)")
    print()

    run_multiple_validations(vrm_files)


if __name__ == "__main__":
    main()
