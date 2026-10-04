# Hockey Life prepared-player artwork library

This feature adds an optional, identity-safe artwork layer to the existing Home League Leaders module. Home facts and navigation do not wait for it. A rejected, timed-out, oversized, malformed, wrong-league, wrong-style, duplicate, or unknown-version manifest is ignored.

## Runtime protocol

The app reads only:

`https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-artwork/approved/hockey-life/manifest-v1.json`

The complete manifest is schema version `1`, league `d6e55507-6eae-4d94-978c-47c6c30a36f1`, style `hl-leader-podium-v1`, and has a UTC `generatedAt`. Each approved entry has `playerId`, exact current `sourcePortraitUrl`, SHA-256 of those portrait bytes, canonical content-addressed `imageUrl`, final RGBA PNG SHA-256, dimensions, and UTC `approvedAt`. The only accepted image URL is:

`https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/player-artwork/approved/hockey-life/<playerId>/<imageSha256>.png`

The app matches league + canonical player ID + exact current portrait URL + style. It does not match names or the selected metric. A changed portrait immediately makes old artwork ineligible. Fallback is remote approved art → bundled approved Jack art when Jack's exact identity still matches → current profile photo → anonymous helmeted art. Source errors are attempt-owned, including A→B→A identity changes.

The loader bounds the body to 512 KiB and 500 entries, times out after four seconds, and revalidates after 15 minutes. It prefetches only the currently featured remote image. Content-addressed URLs use React Native's `force-cache`; actual memory/disk eviction remains OS/network-stack managed, so the app does not claim a strict disk budget. New approved manifest entries become available without another binary release.

## Operator queue

The queue is local and makes no network, AI, storage, publication, or paid-provider calls. Drafts and receipts stay local. Its roster adapter accepts the canonical `roster/roster.json` schema version 1, verifies exact league/current-season eligibility, deduplicates player IDs, and re-hashes every downloaded portrait before it creates a job. Job identity is league + player + portrait-byte SHA-256 + style. Current metric leaders retain the roster scout's queue order, followed by all other current eligible photographed players. Missing-photo players are reported and never generated.

Run from the repository root:

```sh
ARTIFACT=/Users/tonysoprano/workspaces/tony/artifacts/hockey-life-player-library-20261004
node scripts/player-artwork/queue.mjs plan --roster "$ARTIFACT/roster/roster.json" --state "$ARTIFACT/queue/state.json"
node scripts/player-artwork/queue.mjs prepare --state "$ARTIFACT/queue/state.json" --limit 10 --out "$ARTIFACT/queue/provider-packets.json"
```

`prepare` emits bounded prompt/source packets and leaves jobs queued. After the parent explicitly chooses jobs and runs the provider, record the attempt and candidate:

```sh
node scripts/player-artwork/queue.mjs start --state "$ARTIFACT/queue/state.json" --jobs '<job-id>[,<job-id>]'
node scripts/player-artwork/queue.mjs review --state "$ARTIFACT/queue/state.json" --job '<job-id>' --output '/absolute/path/final.png'
```

`review` requires a real, non-interlaced 8-bit RGBA PNG between 256 and 4096 pixels in each dimension and scans decoded alpha pixels for both transparent and visible content. It does not approve the image. Human review must verify likeness, complete equipment and stick, official HL branding, complete podium, true transparency, and absence of names/stats. Then supply an explicit receipt bound to league, player, exact source URL and source-byte hash, style, and final output hash:

```json
{
  "reviewer": "human identity",
  "reviewedAt": "2026-10-04T12:00:00.000Z",
  "leagueId": "d6e55507-6eae-4d94-978c-47c6c30a36f1",
  "playerId": "canonical UUID",
  "sourcePortraitUrl": "exact current URL",
  "sourcePortraitSha256": "64 lowercase hex",
  "styleVersion": "hl-leader-podium-v1",
  "outputSha256": "64 lowercase hex",
  "approved": true,
  "identityConfirmed": true,
  "brandingConfirmed": true,
  "transparencyConfirmed": true,
  "noTextOrStatsConfirmed": true
}
```

```sh
node scripts/player-artwork/queue.mjs approve --state "$ARTIFACT/queue/state.json" --job '<job-id>' --receipt '/absolute/path/review-receipt.json'
node scripts/player-artwork/queue.mjs manifest --state "$ARTIFACT/queue/state.json" --out "$ARTIFACT/queue/manifest-v1.candidate.json"
```

The candidate manifest contains only current explicitly approved jobs. Publication is deliberately separate: upload each approved PNG create-only at its exact manifest object path, verify its public bytes/hash/content type/no redirect surprise, then atomically replace the complete manifest. No publisher is included because this repository has no narrow credential-free transport. A failed retry records failure without downgrading an already approved current job; portrait changes supersede the old identity, so old art cannot enter the next manifest. Failed jobs may be retried at most three times:

```sh
node scripts/player-artwork/queue.mjs fail --state "$ARTIFACT/queue/state.json" --job '<job-id>' --message 'bounded reason'
node scripts/player-artwork/queue.mjs retry --state "$ARTIFACT/queue/state.json" --job '<job-id>'
```

No database migration is required. The public bucket contains approved immutable PNGs plus one validated manifest; queue state, raw generations, and review receipts remain local.
