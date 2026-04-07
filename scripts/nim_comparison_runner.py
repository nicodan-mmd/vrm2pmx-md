from __future__ import annotations

import argparse
import io
import json
import statistics
import tempfile
import time
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from mmd.PmxReader import PmxReader
from service.Vrm2PmxBytesService import convert_vrm_zip_bytes


@dataclass
class OutputCounts:
    vertices: int
    faces: int
    bones: int
    morphs: int
    materials: int
    textures: int
    rigidbodies: int
    joints: int


@dataclass
class RunResult:
    run_index: int
    elapsed_ms: int
    pmx_entry: str
    counts: OutputCounts


def _count_vertices_from_indices(indices: list[int]) -> int:
    if not indices:
        return 0
    return int(max(indices) + 1)


def extract_counts_from_zip(zip_bytes: bytes) -> tuple[OutputCounts, str]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        names = [name for name in zf.namelist() if not name.endswith("/")]
        pmx_candidates = [name for name in names if name.lower().endswith(".pmx")]
        if not pmx_candidates:
            raise RuntimeError("No PMX file found in conversion ZIP")

        pmx_entry = pmx_candidates[0]
        pmx_data = zf.read(pmx_entry)

        with tempfile.TemporaryDirectory(prefix="nim_cmp_pmx_") as td:
            pmx_path = Path(td) / Path(pmx_entry).name
            pmx_path.write_bytes(pmx_data)
            pmx = PmxReader(str(pmx_path), is_check=False).read_data()

        counts = OutputCounts(
            vertices=_count_vertices_from_indices(getattr(pmx, "indices", [])),
            faces=len(getattr(pmx, "indices", [])) // 3,
            bones=len(getattr(pmx, "bones", {})),
            morphs=len(getattr(pmx, "morphs", {})),
            materials=len(getattr(pmx, "materials", {})),
            textures=len(getattr(pmx, "textures", [])),
            rigidbodies=len(getattr(pmx, "rigidbodies", {})),
            joints=len(getattr(pmx, "joints", {})),
        )
        return counts, pmx_entry


def run_once(model_path: Path, run_index: int) -> RunResult:
    source_bytes = model_path.read_bytes()
    started = time.perf_counter()
    output_zip = convert_vrm_zip_bytes(
        source_bytes,
        file_suffix=model_path.suffix.lower(),
        source_stem=model_path.stem,
        version_name="nim-comparison-poc",
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    counts, pmx_entry = extract_counts_from_zip(output_zip)
    return RunResult(
        run_index=run_index,
        elapsed_ms=elapsed_ms,
        pmx_entry=pmx_entry,
        counts=counts,
    )


def make_summary(runs: list[RunResult]) -> dict[str, Any]:
    elapsed_values = [r.elapsed_ms for r in runs]
    count_signatures = [asdict(r.counts) for r in runs]
    all_counts_equal = all(sig == count_signatures[0] for sig in count_signatures)

    return {
        "run_count": len(runs),
        "elapsed_ms": {
            "min": min(elapsed_values),
            "max": max(elapsed_values),
            "mean": round(statistics.mean(elapsed_values), 2),
            "median": round(statistics.median(elapsed_values), 2),
        },
        "counts_stable": all_counts_equal,
        "reference_counts": count_signatures[0],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run repeated conversion comparison for Nim PoC planning")
    parser.add_argument("--model", required=True, help="Absolute path to target VRM/GLB model")
    parser.add_argument("--runs", type=int, default=3, help="Number of repeated runs")
    parser.add_argument(
        "--out-dir",
        default="docs/Nim-Conversion/Comparisons",
        help="Output directory for comparison artifacts",
    )
    args = parser.parse_args()

    model_path = Path(args.model)
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    run_results: list[RunResult] = []
    for idx in range(1, args.runs + 1):
        run_results.append(run_once(model_path, idx))

    now = datetime.now()
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    slug = model_path.stem

    summary = make_summary(run_results)
    record = {
        "input_name": model_path.name,
        "input_path": str(model_path),
        "requested_mode": "nim",
        "actual_mode": "wasm",
        "fallback_reason": "Nim experimental converter is not available in this build yet.",
        "timestamp": now.isoformat(timespec="seconds"),
        "runs": [
            {
                "run_index": r.run_index,
                "elapsed_ms": r.elapsed_ms,
                "pmx_entry": r.pmx_entry,
                "counts": asdict(r.counts),
            }
            for r in run_results
        ],
        "summary": summary,
        "notes": [
            "Current implementation uses Python/Wasm-compatible conversion path for repeatability checks.",
            "Nim runtime is not connected yet; this record provides baseline and stability evidence.",
        ],
    }

    json_path = out_dir / f"{timestamp}_{slug}_nim-validation.json"
    json_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

    md_lines: list[str] = []
    md_lines.append(f"# Nim Comparison Run - {model_path.name}")
    md_lines.append("")
    md_lines.append(f"- input_path: {model_path}")
    md_lines.append("- requested_mode: nim")
    md_lines.append("- actual_mode: wasm")
    md_lines.append("- fallback_reason: Nim experimental converter is not available in this build yet.")
    md_lines.append(f"- run_count: {summary['run_count']}")
    md_lines.append("")
    md_lines.append("## Elapsed (ms)")
    md_lines.append("")
    md_lines.append(
        f"- min={summary['elapsed_ms']['min']} max={summary['elapsed_ms']['max']} "
        f"mean={summary['elapsed_ms']['mean']} median={summary['elapsed_ms']['median']}"
    )
    md_lines.append("")
    md_lines.append("## Count Stability")
    md_lines.append("")
    md_lines.append(f"- counts_stable: {summary['counts_stable']}")
    md_lines.append(f"- reference_counts: {json.dumps(summary['reference_counts'], ensure_ascii=False)}")
    md_lines.append("")
    md_lines.append("## Per Run")
    md_lines.append("")
    for r in run_results:
        md_lines.append(
            f"- run#{r.run_index}: elapsed_ms={r.elapsed_ms}, pmx_entry={r.pmx_entry}, "
            f"counts={json.dumps(asdict(r.counts), ensure_ascii=False)}"
        )

    md_path = out_dir / f"{timestamp}_{slug}_nim-validation.md"
    md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")

    print(str(json_path))
    print(str(md_path))


if __name__ == "__main__":
    main()
