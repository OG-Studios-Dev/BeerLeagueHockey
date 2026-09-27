# Hockey Life Times renderer

This package owns one deterministic, dependency-light renderer for the admin preview, public edition, PDF, and PNG pages. It produces five fixed portrait newspaper sheets (853 by 1280 CSS pixels) and never fetches fonts or layout assets from a CDN.

## Integration surface

```ts
import {
  renderNewspaperHtml,
  renderNewspaperText,
  validateNewspaperEdition,
  type NewspaperEdition,
} from '@hockey-life/hockey-life-times';
```

`renderNewspaperHtml(edition)` validates before rendering and throws a path-specific error when required data is missing. All editorial text and attributes are escaped. Images accept `http:`, `https:`, `data:image`, `blob:`, `file:`, or root-relative sources; unsupported protocols render a newspaper-styled placeholder.

The render-ready limits are two completed games, exactly three stars, ten numbers, fourteen standings rows, three Heater items, three Cold Tub items, four upcoming fixtures, and four Around the Rink items. Contributor arrays are complete and are rendered without truncation. These limits prevent silent omission: validation fails instead of dropping supplied facts. An empty `upcoming` array is valid only when `upcomingNote` explains the lack of scheduled fixtures.

`renderNewspaperText(edition)` is the native-readable fallback for accessibility, indexing, or channels that cannot display the designed edition. It retains every contributor but excludes source IDs, verification timestamps, raw warning strings, and warning counts. Those remain available to storage and export manifests rather than becoming reader-facing copy.

## Reproducible export

```sh
node packages/hockey-life-times/scripts/export-newspaper.mjs \
  --edition /absolute/path/to/edition.json \
  --output /absolute/path/to/output-directory \
  --illustrations /optional/path/to/art-overrides.json
```

The optional illustration overlay can set `leadImageUrl`, `gameImageUrls` keyed by game ID, `playerIllustrationUrls` keyed by player ID, and `briefImageUrls` keyed by exact brief headline. It leaves the factual edition JSON untouched. The exporter calls the shared renderer, embeds readable local image files as data URLs, waits for fonts, verifies every image has non-zero natural dimensions, writes HTML and text, captures one 1706 by 2560 PNG per page, prints the five-page PDF using the CSS page size, and writes `screenshot-manifest.json` with SHA-256 hashes and DOM overflow results. Broken or unloaded images fail the export with an actionable `export-diagnostics.json`.

The exporter resolves a normal installed `playwright` package by default. Set `HLT_PLAYWRIGHT_PATH` to an explicit Playwright package directory when using an isolated runtime, and optionally set `HLT_CHROME_PATH` to a Chrome/Chromium executable. No task-specific runtime path is built into the package.

`fixtures/validation-edition.json` is synthetic validation data only. It deliberately includes long names, dangerous-looking text, and no upcoming games. It is not a user edition and must never be published.

## Admin-only approved issue import

`scripts/import-approved-issue.mjs` imports a pre-reviewed artifact without
running article or image generation. It has explicit `prepare`, `draft`, and
`publish` stages and is a dry run unless `--execute` is supplied. Run
`--help` for the complete required argument list. The source edition, review
verification, delivered PDF, fact pack, actor, project, league, and season are
all explicitly bound; the script never loads a `.env` file.

The prepare stage verifies each original illustration PNG against its approved
manifest digest, then binds the optimized JPEG to the exact bytes embedded
under that player or story's field-specific alt text in the approved PDF export
HTML. Swapping in another valid approved player's JPEG therefore fails. The
approved edition and delivered PDF retain independent raw-file SHA-256 checks,
and the plan records the original PNG, approved-export JPEG, PDF, and decoded
pixel evidence separately. The importer then losslessly decodes the JPEG into
a content-addressed PNG and proves decoded RGBA pixel equality; it does not
regenerate or reapprove artwork.

The draft stage uses the existing generation lease and completion RPCs and
persists an unpublished draft. Semantic structured-data hashes recursively
canonicalize object keys for JSONB readback while preserving array order and
exact strings; source JSON, PDF, and fact-pack checks remain raw byte hashes.
The publish stage is separate, requires an exact edition ID and version,
rechecks source game identity, final status, teams, scores, and completed-game
coverage for the reviewed week, promotes media create-only with hash readback,
then uses the atomic publication RPC. Its reader fallback comes from the shared
`renderNewspaperText` projection with published status, retaining every
contributor and Around the Rink item without a draft label.

Publication keeps the original eight-argument RPC signature. Before promoting
public media, the tool validates that the checked-in function body contains the
atomic non-primary game, team, and contributor-player inserts, then uses the
already-authenticated Supabase CLI for one read-only catalog query. Publication
fails closed unless the live `prosrc` SHA-256 exactly matches the checked-in
dollar-quoted body bytes. The PostgREST signature check, stored-draft binding,
and all article/link readbacks remain in place; no post-publication tag edits
are attempted.
