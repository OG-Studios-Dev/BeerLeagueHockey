#!/usr/bin/env python3
"""Reject tracked Claude settings that grant blanket project MCP trust."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import PurePosixPath


MAX_SETTINGS_BYTES = 1_000_000


class DuplicateKeyError(ValueError):
    pass


def _run_git(*args: str) -> bytes:
    result = subprocess.run(
        ["git", *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise RuntimeError("git metadata could not be inspected")
    return result.stdout


def _tracked_entries() -> list[tuple[str, str, str]]:
    entries: list[tuple[str, str, str]] = []
    for record in _run_git("ls-files", "--stage", "-z").split(b"\0"):
        if not record:
            continue
        metadata, separator, raw_path = record.partition(b"\t")
        if not separator:
            raise RuntimeError("unexpected git index record")
        try:
            mode, object_id, stage = metadata.decode("ascii").split()
            path = raw_path.decode("utf-8")
        except (UnicodeDecodeError, ValueError) as exc:
            raise RuntimeError("unsupported git index record") from exc
        if stage != "0":
            raise RuntimeError("unmerged git index entries must be resolved")
        entries.append((mode, object_id, path))
    return entries


def _is_claude_settings(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return len(parts) >= 2 and parts[-2] == ".claude" and parts[-1] in {
        "settings.json",
        "settings.local.json",
    }


def _is_local_settings(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return len(parts) >= 2 and parts[-2:] == (".claude", "settings.local.json")


def _display_path(path: str) -> str:
    return path.encode("unicode_escape", errors="backslashreplace").decode("ascii")


def _no_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError("duplicate JSON key")
        result[key] = value
    return result


def _has_disallowed_blanket_trust(value: object) -> bool:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "enableAllProjectMcpServers" and nested is not False:
                return True
            if _has_disallowed_blanket_trust(nested):
                return True
    elif isinstance(value, list):
        return any(_has_disallowed_blanket_trust(item) for item in value)
    return False


def main() -> int:
    try:
        entries = _tracked_entries()
    except RuntimeError as exc:
        print(f"MCP trust check could not run: {exc}", file=sys.stderr)
        return 2

    violations: list[str] = []
    for mode, object_id, path in entries:
        if _is_local_settings(path):
            violations.append(f"tracked developer-local Claude settings: {_display_path(path)}")

        if not _is_claude_settings(path):
            continue
        if mode == "120000":
            violations.append(f"Claude settings must not be a symlink: {_display_path(path)}")
            continue
        if mode not in {"100644", "100755"}:
            violations.append(f"unsupported Claude settings file type: {_display_path(path)}")
            continue

        try:
            raw = _run_git("cat-file", "blob", object_id)
            if len(raw) > MAX_SETTINGS_BYTES:
                raise ValueError("settings file exceeds size limit")
            parsed = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys)
        except (RuntimeError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            violations.append(
                f"invalid or unreadable Claude settings: {_display_path(path)} ({type(exc).__name__})"
            )
            continue

        if not isinstance(parsed, dict):
            violations.append(f"Claude settings root must be an object: {_display_path(path)}")
        elif _has_disallowed_blanket_trust(parsed):
            violations.append(f"blanket project MCP trust is forbidden: {_display_path(path)}")

    if violations:
        print("Claude MCP trust policy failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1

    print("Claude MCP trust policy passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
