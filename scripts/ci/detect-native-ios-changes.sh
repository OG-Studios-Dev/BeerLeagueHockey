#!/usr/bin/env bash
set -euo pipefail

base_sha="${BASE_SHA:-}"
head_sha="${GITHUB_SHA:-}"

if [[ -z "$head_sha" ]]; then
  echo "GITHUB_SHA is required" >&2
  exit 1
fi

if [[ -z "$base_sha" || "$base_sha" =~ ^0+$ ]]; then
  if ! base_sha="$(git rev-parse "${head_sha}^")"; then
    echo "Unable to resolve a comparison base for $head_sha" >&2
    exit 1
  fi
fi

if ! git cat-file -e "${base_sha}^{commit}"; then
  echo "Invalid or missing base commit: $base_sha" >&2
  exit 1
fi
if ! git cat-file -e "${head_sha}^{commit}"; then
  echo "Invalid or missing head commit: $head_sha" >&2
  exit 1
fi

if ! changed_paths="$(git diff --name-only "$base_sha" "$head_sha" -- apps/ios/)"; then
  echo "Unable to diff $base_sha..$head_sha" >&2
  exit 1
fi

if [[ -n "$changed_paths" ]]; then
  echo "ios-native=true" >> "$GITHUB_OUTPUT"
else
  echo "ios-native=false" >> "$GITHUB_OUTPUT"
fi
