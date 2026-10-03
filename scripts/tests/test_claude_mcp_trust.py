#!/usr/bin/env python3
"""Integration tests for the tracked-index Claude MCP trust guard."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest


GUARD = Path(__file__).parents[1] / "security" / "check_claude_mcp_trust.py"


class ClaudeMcpTrustGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp_dir.name)
        self.git("init", "--quiet")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=self.repo,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def write_json(self, relative_path: str, value: object) -> None:
        path = self.repo / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")

    def run_guard(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(GUARD)],
            cwd=self.repo,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def test_false_or_absent_blanket_setting_passes(self) -> None:
        self.write_json(".claude/settings.json", {"enableAllProjectMcpServers": False})
        self.write_json("apps/web/.claude/settings.json", {"hooks": {}})
        self.git("add", ".")
        self.assertEqual(self.run_guard().returncode, 0)

    def test_tracked_ignored_local_file_and_true_setting_fail_without_leak(self) -> None:
        marker = "do-not-print-this-permission"
        (self.repo / ".gitignore").write_text(
            "**/.claude/settings.local.json\n", encoding="utf-8"
        )
        self.write_json(
            "apps/web/.claude/settings.local.json",
            {
                "enableAllProjectMcpServers": True,
                "permissions": {"allow": [marker]},
            },
        )
        self.git("add", ".gitignore")
        self.git("add", "-f", "apps/web/.claude/settings.local.json")

        result = self.run_guard()

        self.assertEqual(result.returncode, 1)
        self.assertIn("tracked developer-local Claude settings", result.stderr)
        self.assertIn("blanket project MCP trust is forbidden", result.stderr)
        self.assertNotIn(marker, result.stdout + result.stderr)

    def test_staged_deletion_of_local_file_is_treated_as_removed(self) -> None:
        self.write_json(".claude/settings.json", {"enableAllProjectMcpServers": False})
        self.write_json(".claude/settings.local.json", {"permissions": {}})
        self.git("add", ".")
        self.assertEqual(self.run_guard().returncode, 1)

        self.git("rm", "--cached", ".claude/settings.local.json")

        self.assertEqual(self.run_guard().returncode, 0)

    def test_guard_reads_staged_blob_not_unstaged_worktree(self) -> None:
        self.write_json(".claude/settings.json", {"enableAllProjectMcpServers": False})
        self.git("add", ".claude/settings.json")
        self.write_json(".claude/settings.json", {"enableAllProjectMcpServers": True})
        self.assertEqual(self.run_guard().returncode, 0)

        self.git("add", ".claude/settings.json")

        self.assertEqual(self.run_guard().returncode, 1)

    def test_invalid_json_and_symlink_fail_closed(self) -> None:
        invalid = self.repo / ".claude" / "settings.json"
        invalid.parent.mkdir(parents=True)
        invalid.write_text("{", encoding="utf-8")
        self.git("add", ".claude/settings.json")
        self.assertEqual(self.run_guard().returncode, 1)

        self.git("rm", "--cached", ".claude/settings.json")
        invalid.unlink()
        invalid.symlink_to("../outside.json")
        self.git("add", ".claude/settings.json")

        result = self.run_guard()
        self.assertEqual(result.returncode, 1)
        self.assertIn("must not be a symlink", result.stderr)


if __name__ == "__main__":
    unittest.main()
