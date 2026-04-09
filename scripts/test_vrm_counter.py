#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test VrmCounterService against known baselines.
"""
import json
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from service.VrmCounterService import VrmCounterService


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_vrm_counter.py <vrm_file> [--baseline-json <file>]")
        sys.exit(1)

    vrm_path = sys.argv[1]
    baseline_file = None

    if "--baseline-json" in sys.argv:
        idx = sys.argv.index("--baseline-json")
        if idx + 1 < len(sys.argv):
            baseline_file = sys.argv[idx + 1]

    if not Path(vrm_path).exists():
        print(f"Error: File not found: {vrm_path}")
        sys.exit(1)

    print(f"Counting: {vrm_path}")

    # Count using Python service
    counter = VrmCounterService(vrm_path)
    result = counter.count()

    if result.error_msg:
        print(f"Error: {result.error_msg}")
        sys.exit(1)

    # Display results
    print("\nGeometry Count (Python):")
    print(f"  Vertices:     {result.vertices}")
    print(f"  Faces:        {result.faces}")
    print(f"  Bones:        {result.bones}")
    print(f"  Morphs:       {result.morphs}")
    print(f"  Materials:    {result.materials}")
    print(f"  Textures:     {result.textures}")
    print(f"  Rigidbodies:  {result.rigidbodies}")
    print(f"  Joints:       {result.joints}")

    # Compare with baseline if provided
    if baseline_file and Path(baseline_file).exists():
        print(f"\nComparing with baseline: {baseline_file}")
        baseline_data = json.loads(Path(baseline_file).read_text(encoding='utf-8'))

        baseline_counts = baseline_data.get("counts", {})

        all_match = True
        for key in ["vertices", "faces", "bones", "morphs", "materials", "textures"]:
            python_val = getattr(result, key)
            baseline_val = baseline_counts.get(key, None)

            if baseline_val is None:
                continue

            match = "✓" if python_val == baseline_val else "✗"
            if python_val != baseline_val:
                all_match = False
            print(f"  {key:12s}: {python_val:6d} vs baseline {baseline_val:6d} {match}")

        if all_match:
            print("\n✓ All counts match baseline!")
        else:
            print("\n✗ Some counts differ from baseline")
            sys.exit(1)

    print("\nDone.")


if __name__ == "__main__":
    main()
