#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import configparser
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def load_sentry_token() -> str:
    token = os.environ.get("SENTRY_AUTH_TOKEN", "").strip()
    if token:
        return token

    cfg_path = Path.home() / ".sentryclirc"
    if cfg_path.exists():
        parser = configparser.ConfigParser()
        parser.read(cfg_path, encoding="utf-8")
        if parser.has_option("auth", "token"):
            token = parser.get("auth", "token", fallback="").strip()
            if token:
                return token

    raise RuntimeError("SENTRY_AUTH_TOKEN not found in env or ~/.sentryclirc")


def request_json(url: str, token: str) -> dict[str, Any]:
    if not url.startswith("https://sentry.io/api/0/"):
        raise RuntimeError(f"Unexpected URL: {url}")

    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:  # nosec B310
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} for {url}: {body}") from e


def resolve_event(
    token: str,
    org: str,
    project: str,
    issue_id: str | None,
    event_id: str | None,
) -> dict[str, Any]:
    if issue_id:
        return request_json(
            f"https://sentry.io/api/0/issues/{issue_id}/events/latest/", token
        )

    if event_id:
        return request_json(
            f"https://sentry.io/api/0/projects/{org}/{project}/events/{event_id}/",
            token,
        )

    raise RuntimeError("Either --issue-id or --event-id is required")


def deep_collect_data_urls(payload: Any, out: dict[str, str]) -> None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in {"preview_vrm_data_url", "preview_pmx_data_url"} and isinstance(
                value, str
            ):
                out[key] = value
            deep_collect_data_urls(value, out)
    elif isinstance(payload, list):
        for item in payload:
            deep_collect_data_urls(item, out)


def parse_data_url(data_url: str) -> tuple[str, bytes]:
    m = re.match(r"^data:([^;]+);base64,(.+)$", data_url, flags=re.DOTALL)
    if not m:
        raise ValueError("Not a base64 data URL")

    mime = m.group(1).strip().lower()
    raw_b64 = m.group(2).strip().replace("\n", "")

    padding = len(raw_b64) % 4
    if padding:
        raw_b64 += "=" * (4 - padding)

    return mime, base64.b64decode(raw_b64)


def extension_for_mime(mime: str) -> str:
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }
    return mapping.get(mime, ".bin")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Restore preview_vrm_data_url / preview_pmx_data_url images from Sentry event"
    )
    parser.add_argument("--org", default="nicodan", help="Sentry org slug")
    parser.add_argument(
        "--project", default="vrm_to_pmx_converterr", help="Sentry project slug"
    )
    parser.add_argument("--issue-id", help="Numeric issue ID (e.g. 7363547311)")
    parser.add_argument("--event-id", help="Event ID (32 hex)")
    parser.add_argument(
        "--out-dir",
        default="tmp/sentry-preview-restore",
        help="Output directory for restored images",
    )
    args = parser.parse_args()

    token = load_sentry_token()
    event = resolve_event(token, args.org, args.project, args.issue_id, args.event_id)

    data_urls: dict[str, str] = {}
    deep_collect_data_urls(event, data_urls)

    if not data_urls:
        print("No preview_*_data_url fields found in the event payload.")
        return 2

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    resolved_event_id = str(event.get("eventID") or event.get("id") or "unknown")
    restored_files: list[str] = []
    warnings: list[str] = []

    for key, data_url in sorted(data_urls.items()):
        try:
            mime, data = parse_data_url(data_url)
            ext = extension_for_mime(mime)
            out_path = out_dir / f"{resolved_event_id}_{key}{ext}"
            out_path.write_bytes(data)
            restored_files.append(str(out_path).replace("\\", "/"))
        except Exception as e:  # noqa: BLE001
            warnings.append(f"{key}: {e}")

    meta = {
        "event_id": resolved_event_id,
        "issue_id": args.issue_id,
        "restored_files": restored_files,
        "warnings": warnings,
    }
    meta_path = out_dir / f"{resolved_event_id}_restore_meta.json"
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"event_id={resolved_event_id}")
    print(f"restored={len(restored_files)}")
    for fp in restored_files:
        print(f"file={fp}")
    if warnings:
        for w in warnings:
            print(f"warn={w}", file=sys.stderr)
    meta_path_str = str(meta_path).replace("\\", "/")
    print(f"meta={meta_path_str}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
