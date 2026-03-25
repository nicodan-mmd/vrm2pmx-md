#!/usr/bin/env python3
"""
Sentry quality signal statistics collector via sentry-cli events list output.
Parses tabular output and aggregates statistics.

Usage:
    python scripts/sentry/collect_stats.py

Requirements:
    - sentry-cli installed and authenticated
    - SENTRY_AUTH_TOKEN env var configured (or ~/.sentryclirc)
"""

import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def run_sentry_cli() -> str:
    """Fetch events from sentry-cli."""
    cmd = [
        "sentry-cli",
        "events",
        "list",
        "--org",
        "nicodan",
        "--project",
        "vrm_to_pmx_converterr",
        "--pages",
        "5",
        "--show-tags",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"Error running sentry-cli: {e.stderr}", file=sys.stderr)
        sys.exit(1)


def parse_events(output: str) -> list[dict]:
    """
    Parse sentry-cli events list output.
    Handles multi-line tag values.
    """
    lines = output.split("\n")
    events = []
    current_event = None

    for line in lines:
        # Skip separator and empty lines
        if not line.strip() or line.startswith("+") or "---" in line:
            continue

        # Event ID line: starts with UUID
        uuid_pattern = r"^[\s\|]*([a-f0-9\-]{36})"
        uuid_match = re.match(uuid_pattern, line)
        if uuid_match and len(uuid_match.group(1)) == 36:
            # Save previous event
            if current_event and current_event.get("tags"):
                events.append(current_event)
            current_event = {
                "event_id": uuid_match.group(1),
                "tags": {}
            }
            continue

        # Tag lines: "key: value" format
        if current_event is not None:
            # Extract text between pipes, handling wrapped lines
            parts = line.split("|")
            for part in parts:
                part = part.strip()
                if not part or part == "Date" or "Event ID" in part or "Title" in part or "Tags" in part:
                    continue
                
                # Look for "key: value" pattern
                if ": " in part:
                    key, value = part.split(": ", 1)
                    key = key.strip()
                    value = value.strip()
                    if key and value and len(key) < 50:  # Reasonable key length
                        current_event["tags"][key] = value

    # Add last event
    if current_event and current_event.get("tags"):
        events.append(current_event)

    return events


def aggregate_stats(events: list[dict]) -> dict:
    """Calculate statistics from quality_signal events."""
    stats = {
        "total_events": len(events),
        "quality_signal_events": 0,
        "by_signal_code": defaultdict(int),
        "by_signal_source": defaultdict(int),
        "by_mode": defaultdict(int),
        "by_result": defaultdict(int),
        "by_release": defaultdict(int),
        "signal_matrix": defaultdict(lambda: defaultdict(int)),
    }

    for event in events:
        tags = event.get("tags", {})

        # Filter only quality_signal events
        if tags.get("event_type") != "quality_signal":
            continue

        stats["quality_signal_events"] += 1

        signal_code = tags.get("signal_code", "UNKNOWN")
        signal_source = tags.get("signal_source", "UNKNOWN")
        mode = tags.get("mode", "UNKNOWN")
        result = tags.get("result", "UNKNOWN")
        release = tags.get("release", "UNKNOWN")

        stats["by_signal_code"][signal_code] += 1
        stats["by_signal_source"][signal_source] += 1
        stats["by_mode"][mode] += 1
        stats["by_result"][result] += 1
        stats["by_release"][release] += 1
        stats["signal_matrix"][signal_code][signal_source] += 1

    return {
        "timestamp": datetime.now().isoformat(),
        "total_events": stats["total_events"],
        "quality_signal_events": stats["quality_signal_events"],
        "by_signal_code": dict(sorted(stats["by_signal_code"].items())),
        "by_signal_source": dict(stats["by_signal_source"]),
        "by_mode": dict(stats["by_mode"]),
        "by_result": dict(stats["by_result"]),
        "by_release": dict(stats["by_release"]),
        "signal_matrix": {
            code: dict(sources) for code, sources in stats["signal_matrix"].items()
        },
    }


def main():
    """Main entry point."""
    print("Fetching Sentry events from sentry-cli...")
    output = run_sentry_cli()

    print("Parsing events...")
    events = parse_events(output)
    print(f"Found {len(events)} total events")

    print("Aggregating statistics...")
    stats = aggregate_stats(events)

    # Output results
    print("\n" + "=" * 60)
    print("QUALITY SIGNAL STATISTICS")
    print("=" * 60)
    print(f"Timestamp: {stats['timestamp']}")
    print(f"Total Events: {stats['total_events']}")
    print(f"Quality Signal Events: {stats['quality_signal_events']}")

    if stats["quality_signal_events"] == 0:
        print("\n⚠️  No quality_signal events found.")
        print("(Events may be filtered out or no conversions have run yet)")
    else:
        print("\n--- By Signal Code ---")
        for code, count in sorted(
            stats["by_signal_code"].items(), key=lambda x: x[1], reverse=True
        ):
            print(f"  {code}: {count}")

        print("\n--- By Signal Source ---")
        for source, count in sorted(
            stats["by_signal_source"].items(), key=lambda x: x[1], reverse=True
        ):
            print(f"  {source}: {count}")

        print("\n--- By Mode ---")
        for mode, count in sorted(stats["by_mode"].items(), key=lambda x: x[1], reverse=True):
            print(f"  {mode}: {count}")

        print("\n--- By Result ---")
        for result, count in sorted(
            stats["by_result"].items(), key=lambda x: x[1], reverse=True
        ):
            print(f"  {result}: {count}")

        print("\n--- By Release ---")
        for release, count in sorted(
            stats["by_release"].items(), key=lambda x: x[1], reverse=True
        ):
            print(f"  {release}: {count}")

        print("\n--- Signal Code x Signal Source Matrix ---")
        for code in sorted(stats["signal_matrix"].keys()):
            print(f"  {code}:")
            for source, count in sorted(stats["signal_matrix"][code].items()):
                print(f"    {source}: {count}")

    # Save JSON report
    report_path = Path(__file__).parent.parent.parent / "docs" / "Sentry-Reports" / f"quality-stats-{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Report saved to: {report_path}")


if __name__ == "__main__":
    main()
