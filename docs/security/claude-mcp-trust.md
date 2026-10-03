# Claude MCP trust policy

This repository keeps MCP available while refusing blanket automatic approval of every project MCP server. Shared `.claude/settings.json` explicitly sets `enableAllProjectMcpServers` to `false`; individual developers can still review and approve a server when needed.

Developer-specific approvals belong in untracked `.claude/settings.local.json` files. Existing clones must first remove any already-tracked copy from the Git index, then remove the broad `enableAllProjectMcpServers` flag (or set it to `false`) in local and user settings. The new ignore rule prevents ordinary future additions, but `.gitignore` does not make a file safe if it is already tracked.

Treat MCP configuration changes as code review. A previously approved server name is not a lasting security boundary: the command or package behind that name can change in a later `.mcp.json` diff. Review the command, arguments, package source, and requested access each time rather than relying on a simplistic name allowlist.

The repository guard checks tracked Claude settings and fails closed on malformed JSON or settings symlinks. It does not inspect per-user, local, or managed settings; higher-priority settings and explicit launch overrides can affect the effective configuration. Repository configuration cannot enforce organization-wide device policy.

This change removes a historical broad approval from the current tree; it does not rewrite Git history. It also does not claim that an incident or exploitation audit was performed.
