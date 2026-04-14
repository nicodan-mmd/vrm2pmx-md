#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
frontend_timing_comparison.py

Python / Nim-exe / Nim-Wasm (Node.js) 縺ｮ3繝ｬ繝ｼ繝ｳ縺ｧ隍・焚繝｢繝・Ν縺ｮ螟画鋤譎る俣縺ｨ繝輔ぃ繧､繝ｫ繧ｵ繧､繧ｺ繧呈ｯ碑ｼ・＠縲・docs/Nim-Conversion/Comparisons/ 縺ｫMarkdown縺ｨJSON縺ｧ菫晏ｭ倥☆繧九・
Usage:
    python scripts/frontend_timing_comparison.py \
        "D:/Users/maedashingo/Downloads/MMD/VRoid" \
        [--max-count 26] \
        [--nim-exe tmp/nim/pmx_lite_main.exe] \
        [--wasm frontend/public/nim/vrm2pmx_nim_runtime.wasm] \
        [--output-dir docs/Nim-Conversion/Comparisons]
"""

from __future__ import annotations

import argparse
import json
import subprocess  # nosec B404
import sys
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from nim_bitperfect_validation import run_python_baseline  # noqa: E402


def find_vrm_files(search_root: Path, max_count: int) -> list[Path]:
    results: list[Path] = []
    for p in search_root.rglob("*.vrm"):
        results.append(p)
        if len(results) >= max_count:
            break
    return results


def measure_nim_exe(vrm_path: Path, nim_exe: Path, work_dir: Path) -> dict:
    out_path = work_dir / f"{vrm_path.stem}_nim.pmx"
    started = time.perf_counter()
    proc = subprocess.run(  # nosec B603
        [str(nim_exe), str(vrm_path), str(out_path)],
        capture_output=True,
        timeout=120,
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    if proc.returncode == 0 and out_path.exists():
        return {
            "status": "ok",
            "elapsed_ms": elapsed_ms,
            "output_size": out_path.stat().st_size,
        }
    return {
        "status": "error",
        "elapsed_ms": elapsed_ms,
        "output_size": 0,
        "error": (proc.stderr or proc.stdout or b"").decode(errors="replace")[:200],
    }


def measure_wasm(vrm_path: Path, wasm_path: Path, runner_script: Path) -> dict:
    if not wasm_path.exists():
        return {
            "status": "skip",
            "elapsed_ms": 0,
            "output_size": 0,
            "error": "wasm not found",
        }
    proc = subprocess.run(  # nosec
        ["node", str(runner_script), "--vrm", str(vrm_path), "--wasm", str(wasm_path)],
        capture_output=True,
        timeout=120,
    )
    raw = proc.stdout.decode(errors="replace").strip()
    if not raw:
        return {
            "status": "error",
            "elapsed_ms": 0,
            "output_size": 0,
            "error": proc.stderr.decode(errors="replace")[:200],
        }
    return json.loads(raw)


def format_size(n: int) -> str:
    if n < 0:
        return "-"
    if n >= 1_000_000:
        return f"{n/1_000_000:.2f} MB"
    if n >= 1_000:
        return f"{n/1_000:.1f} KB"
    return f"{n} B"


def build_md(
    rows: list[dict], search_root: Path, nim_exe: Path | None, wasm_path: Path | None
) -> str:
    date_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines: list[str] = [
        f"# Frontend Timing Comparison ({date_str})",
        "",
        "## Settings",
        "",
        f"- Search path: `{search_root}`",
        f"- Nim exe: `{nim_exe}`",
        f"- Wasm: `{wasm_path}`",
        f"- Models: {len(rows)}",
        "",
        "## Results",
        "",
        "Elapsed times are wall-clock milliseconds for a single conversion run.",
        "",
        "| Model | VRM size | Python ms | Python PMX | Nim-exe ms | Nim-exe PMX | Wasm ms | Wasm PMX | Nim-exe speedup | Wasm speedup |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]

    for r in rows:
        model = r["model"]
        vrm_size = format_size(r["vrm_size"])

        py = r["python"]
        nim = r["nim_exe"]
        wasm = r["wasm"]

        py_ms = py.get("elapsed_ms", 0) if py.get("status") == "ok" else "-"
        py_pmx = (
            format_size(py.get("output_size", 0)) if py.get("status") == "ok" else "-"
        )

        nim_ms = nim.get("elapsed_ms", 0) if nim.get("status") == "ok" else "-"
        nim_pmx = (
            format_size(nim.get("output_size", 0)) if nim.get("status") == "ok" else "-"
        )

        wasm_ms = (
            wasm.get("elapsed_ms", 0)
            if wasm.get("status") == "ok"
            else f'skip({wasm.get("status")})'
        )
        wasm_pmx = (
            format_size(wasm.get("output_size", 0))
            if wasm.get("status") == "ok"
            else "-"
        )

        def speedup(py_t, lane_t) -> str:
            if isinstance(py_t, int) and isinstance(lane_t, int) and lane_t > 0:
                return f"{py_t / lane_t:.1f}x"
            return "-"

        nim_su = speedup(py_ms, nim_ms)
        wasm_su = speedup(py_ms, wasm_ms)

        lines.append(
            f"| {model} | {vrm_size} | {py_ms} | {py_pmx} | {nim_ms} | {nim_pmx} | {wasm_ms} | {wasm_pmx} | {nim_su} | {wasm_su} |"
        )

    lines += [
        "",
        "## Summary",
        "",
    ]

    ok_rows = [
        r
        for r in rows
        if r["python"].get("status") == "ok" and r["nim_exe"].get("status") == "ok"
    ]
    if ok_rows:
        avg_py = sum(r["python"]["elapsed_ms"] for r in ok_rows) / len(ok_rows)
        avg_nim = sum(r["nim_exe"]["elapsed_ms"] for r in ok_rows) / len(ok_rows)
        lines.append(f"- Avg Python: {avg_py:.0f} ms")
        lines.append(f"- Avg Nim-exe: {avg_nim:.0f} ms")
        if avg_nim > 0:
            lines.append(f"- Avg Nim-exe speedup: **{avg_py/avg_nim:.1f}x**")

    wasm_ok = [
        r
        for r in rows
        if r["wasm"].get("status") == "ok" and r["python"].get("status") == "ok"
    ]
    if wasm_ok:
        avg_wasm = sum(r["wasm"]["elapsed_ms"] for r in wasm_ok) / len(wasm_ok)
        avg_py_w = sum(r["python"]["elapsed_ms"] for r in wasm_ok) / len(wasm_ok)
        lines.append(f"- Avg Wasm: {avg_wasm:.0f} ms")
        if avg_wasm > 0:
            lines.append(f"- Avg Wasm speedup: **{avg_py_w/avg_wasm:.1f}x**")

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="3-lane timing comparison: Python / Nim-exe / Wasm"
    )
    parser.add_argument("search_path", help="Root directory to search for VRM files")
    parser.add_argument("--max-count", type=int, default=26)
    parser.add_argument("--nim-exe", default="tmp/nim/pmx_lite_main.exe")
    parser.add_argument(
        "--wasm", default="frontend/public/nim/vrm2pmx_nim_runtime.wasm"
    )
    parser.add_argument("--output-dir", default="docs/Nim-Conversion/Comparisons")
    args = parser.parse_args()

    search_root = Path(args.search_path)
    nim_exe = REPO_ROOT / args.nim_exe
    wasm_path = REPO_ROOT / args.wasm
    runner_script = REPO_ROOT / "scripts" / "frontend_wasm_runner.mjs"
    output_dir = REPO_ROOT / args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    work_dir = REPO_ROOT / "tmp" / "timing_comparison_work"
    work_dir.mkdir(parents=True, exist_ok=True)

    vrm_paths = find_vrm_files(search_root, args.max_count)
    if not vrm_paths:
        print(f"No VRM files found under: {search_root}")
        return 1

    print(f"Found {len(vrm_paths)} VRM files")
    print(f"Nim-exe: {nim_exe} (exists={nim_exe.exists()})")
    print(f"Wasm: {wasm_path} (exists={wasm_path.exists()})")
    print()

    rows: list[dict] = []
    for idx, vrm_path in enumerate(vrm_paths, 1):
        rel = (
            vrm_path.relative_to(search_root)
            if vrm_path.is_relative_to(search_root)
            else vrm_path.name
        )
        print(f"[{idx}/{len(vrm_paths)}] {rel}")

        vrm_size = vrm_path.stat().st_size

        # --- Python ---
        print("  Python...", end=" ", flush=True)
        try:
            py_bytes, py_runs = run_python_baseline(vrm_path, 1)
            py_result = {
                "status": "ok",
                "elapsed_ms": int(py_runs[0]["elapsed_ms"]),
                "output_size": len(py_bytes),
            }
        except Exception as exc:
            py_result = {
                "status": "error",
                "elapsed_ms": 0,
                "output_size": 0,
                "error": str(exc)[:200],
            }
        print(f"{py_result.get('elapsed_ms', '-')} ms")

        # --- Nim exe ---
        if nim_exe.exists():
            print("  Nim-exe...", end=" ", flush=True)
            try:
                nim_result = measure_nim_exe(vrm_path, nim_exe, work_dir)
            except Exception as exc:
                nim_result = {
                    "status": "error",
                    "elapsed_ms": 0,
                    "output_size": 0,
                    "error": str(exc)[:200],
                }
            print(f"{nim_result.get('elapsed_ms', '-')} ms")
        else:
            nim_result = {
                "status": "skip",
                "elapsed_ms": 0,
                "output_size": 0,
                "error": "exe not found",
            }
            print("  Nim-exe: skip (not found)")

        # --- Wasm ---
        print("  Wasm...", end=" ", flush=True)
        try:
            wasm_result = measure_wasm(vrm_path, wasm_path, runner_script)
        except Exception as exc:
            wasm_result = {
                "status": "error",
                "elapsed_ms": 0,
                "output_size": 0,
                "error": str(exc)[:200],
            }
        print(f"{wasm_result.get('elapsed_ms', '-')} ms ({wasm_result.get('status')})")

        rows.append(
            {
                "model": vrm_path.stem,
                "relative_path": str(rel),
                "vrm_size": vrm_size,
                "python": py_result,
                "nim_exe": nim_result,
                "wasm": wasm_result,
            }
        )

    # --- Output ---
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"{stamp}_timing_comparison.json"
    md_path = output_dir / f"{stamp}_timing_comparison.md"

    payload = {
        "generated_at": stamp,
        "search_path": str(search_root),
        "nim_exe": str(nim_exe),
        "wasm_path": str(wasm_path),
        "rows": rows,
    }
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    md_text = build_md(rows, search_root, nim_exe, wasm_path)
    md_path.write_text(md_text, encoding="utf-8")

    print()
    print(f"JSON: {json_path}")
    print(f"MD:   {md_path}")

    # Quick summary to stdout
    ok = [
        r
        for r in rows
        if r["python"].get("status") == "ok" and r["nim_exe"].get("status") == "ok"
    ]
    if ok:
        avg_py = sum(r["python"]["elapsed_ms"] for r in ok) / len(ok)
        avg_nim = sum(r["nim_exe"]["elapsed_ms"] for r in ok) / len(ok)
        print(
            f"\nAvg Python: {avg_py:.0f} ms  Nim-exe: {avg_nim:.0f} ms  speedup: {avg_py/max(avg_nim,1):.1f}x"
        )

    wasm_ok = [
        r
        for r in rows
        if r["wasm"].get("status") == "ok" and r["python"].get("status") == "ok"
    ]
    if wasm_ok:
        avg_wasm = sum(r["wasm"]["elapsed_ms"] for r in wasm_ok) / len(wasm_ok)
        avg_py2 = sum(r["python"]["elapsed_ms"] for r in wasm_ok) / len(wasm_ok)
        print(
            f"Avg Wasm: {avg_wasm:.0f} ms  speedup: {avg_py2/max(avg_wasm,1):.1f}x ({len(wasm_ok)} models)"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
