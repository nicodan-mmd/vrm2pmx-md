#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Validate VRM conversion using actual Vrm2PmxExportService (Python backend).
Measures conversion time and output counts.
"""

import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).parent.parent / "frontend" / "public" / "py_src"))

from mmd.PmxReader import PmxReader
from service.Vrm2PmxBytesService import convert_vrm_zip_bytes
from utils.MLogger import MLogger


@dataclass
class CountResult:
    """Single conversion result with counts."""

    run_index: int
    elapsed_ms: int
    counts: dict


@dataclass
class ValidationRun:
    """Full validation run with multiple iterations."""

    input_name: str
    input_path: str
    timestamp: str
    runs: list[CountResult]
    summary: dict


def extract_pmx_counts(pmx_bytes: bytes) -> dict:
    """Extract geometry counts from PMX binary data."""
    import shutil
    import tempfile

    # Write to temp file
    tmp_dir = Path(tempfile.mkdtemp())
    pmx_file = tmp_dir / "temp.pmx"
    pmx_file.write_bytes(pmx_bytes)

    try:
        reader = PmxReader(str(pmx_file), is_check=False)
        pmx_data = reader.read_data()

        if pmx_data is None:
            return {
                "vertices": 0,
                "faces": 0,
                "bones": 0,
                "morphs": 0,
                "materials": 0,
                "textures": 0,
                "rigidbodies": 0,
                "joints": 0,
            }

        # Count vertices (by looking at indices)
        index_count = len(pmx_data.indices) if hasattr(pmx_data, "indices") else 0
        vertex_count = index_count + 1 if index_count > 0 else 0

        return {
            "vertices": vertex_count,
            "faces": len(pmx_data.indices) // 3 if hasattr(pmx_data, "indices") else 0,
            "bones": len(pmx_data.bones) if hasattr(pmx_data, "bones") else 0,
            "morphs": len(pmx_data.morphs) if hasattr(pmx_data, "morphs") else 0,
            "materials": (
                len(pmx_data.materials) if hasattr(pmx_data, "materials") else 0
            ),
            "textures": len(pmx_data.textures) if hasattr(pmx_data, "textures") else 0,
            "rigidbodies": (
                len(pmx_data.rigidbodies) if hasattr(pmx_data, "rigidbodies") else 0
            ),
            "joints": len(pmx_data.joints) if hasattr(pmx_data, "joints") else 0,
        }

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def run_python_conversion(vrm_path: str, num_runs: int = 1) -> ValidationRun:
    """Run VRM conversion and collect metrics."""
    vrm_path_obj = Path(vrm_path)
    if not vrm_path_obj.exists():
        raise FileNotFoundError(f"VRM file not found: {vrm_path}")

    vrm_name = vrm_path_obj.stem
    vrm_bytes = vrm_path_obj.read_bytes()

    results = []

    for i in range(num_runs):
        print(f"Run {i+1}/{num_runs}...", end=" ", flush=True)

        start = time.time()
        try:
            # Convert using Python backend
            zip_bytes = convert_vrm_zip_bytes(
                vrm_bytes,
                file_suffix=".vrm",
                source_stem=vrm_name,
                version_name="python-counter",
                logging_level=MLogger.WARNING,
            )
            elapsed_ms = int((time.time() - start) * 1000)

            # Extract PMX from zip and count
            import io
            import zipfile

            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                pmx_entry = None
                for name in zf.namelist():
                    if name.endswith(".pmx"):
                        pmx_entry = name
                        break

                if pmx_entry:
                    pmx_bytes = zf.read(pmx_entry)
                    counts = extract_pmx_counts(pmx_bytes)
                else:
                    counts = {}

            results.append(CountResult(i + 1, elapsed_ms, counts))
            print(f"OK ({elapsed_ms}ms)")

        except Exception as e:
            print(f"FAILED: {e}")
            raise

    # Calculate summary
    if results:
        elapsed_ms_list = [r.elapsed_ms for r in results]
        summary = {
            "elapsed_ms": {
                "min": min(elapsed_ms_list),
                "max": max(elapsed_ms_list),
                "mean": sum(elapsed_ms_list) / len(elapsed_ms_list),
                "median": sorted(elapsed_ms_list)[len(elapsed_ms_list) // 2],
            },
            "counts_stable": all(r.counts == results[0].counts for r in results),
        }
    else:
        summary = {"elapsed_ms": {}, "counts_stable": False}

    return ValidationRun(
        input_name=vrm_name,
        input_path=str(vrm_path_obj),
        timestamp=datetime.now().isoformat(),
        runs=results,
        summary=summary,
    )


def main():
    if len(sys.argv) < 2:
        print("Usage: python python_vrm_counters.py <vrm_file> [--runs N]")
        sys.exit(1)

    vrm_path = sys.argv[1]
    num_runs = 1

    if "--runs" in sys.argv:
        idx = sys.argv.index("--runs")
        if idx + 1 < len(sys.argv):
            num_runs = int(sys.argv[idx + 1])

    print("VRM Conversion Counter (Python Backend)")
    print(f"File: {vrm_path}")
    print(f"Runs: {num_runs}")
    print()

    result = run_python_conversion(vrm_path, num_runs)

    print("\n=== Results ===")
    print(f"Input: {result.input_name}")
    print(f"Timestamp: {result.timestamp}")
    print()

    for run in result.runs:
        print(f"Run {run.run_index}:")
        print(f"  Time: {run.elapsed_ms}ms")
        print(f"  Vertices: {run.counts.get('vertices', 0)}")
        print(f"  Faces: {run.counts.get('faces', 0)}")
        print(f"  Bones: {run.counts.get('bones', 0)}")
        print(f"  Morphs: {run.counts.get('morphs', 0)}")
        print(f"  Materials: {run.counts.get('materials', 0)}")
        print(f"  Textures: {run.counts.get('textures', 0)}")
        print(f"  Rigidbodies: {run.counts.get('rigidbodies', 0)}")
        print(f"  Joints: {run.counts.get('joints', 0)}")
        print()

    print("Summary:")
    print(f"  Counts Stable: {result.summary['counts_stable']}")
    elapsed = result.summary["elapsed_ms"]
    print(
        f"  Elapsed Time: {elapsed['min']}ms ~ {elapsed['max']}ms (mean={elapsed['mean']:.1f}ms)"
    )


if __name__ == "__main__":
    main()
