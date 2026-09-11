# Home web-style provenance

## Authority and interpretation

This Home-only native treatment is an interpretation of the pinned BLH league-sites redesign at commit `e213a56b0f8332db34276fe6267ff8e9aa019250`. There is no mobile Figma or native-device reference, so this work does not claim pixel parity. It translates the web visual identity to native layout and interaction constraints while retaining the existing mobile Home data and navigation.

Pinned source snapshots consulted:

- `apps/league-sites/src/app/globals.css` — dark foundation and exact public glass hierarchy: `--blh-night: #07111f`, `--blh-navy: #0a1628`, `--blh-navy-strong: #0c1b31`, `--color-background-sunken: #030a13`, `--blh-white: #f8fbff`, `--blh-slate: #a9b8cc`, `--blh-glass-surface: rgba(10, 22, 40, 0.3)`, `--blh-glass-border: rgba(125, 190, 255, 0.22)`, `--glass-card-top: rgba(12, 27, 49, 0.38)`, and `--glass-card-bottom: rgba(7, 17, 31, 0.24)`.
- `apps/league-sites/src/components/home/HomepageStoryHero.tsx` — editorial eyebrow/title hierarchy, dark stage overlays, restrained tenant accent, and reduced-motion handling.
- `apps/league-sites/src/components/home/HomepageWeeklyGames.tsx` — matchup-stage composition, readable team names, venue/time/status data, compact layout, and score treatment.
- `apps/league-sites/src/components/home/HomepagePulseRail.tsx` — compact editorial cards, uppercase labels, clear hierarchy, and bounded supporting metadata.
- `apps/league-sites/src/app/[leagueSlug]/page.tsx` — Home composition and ordering. No web data queries, business rules, or web-only features were copied.

The read-only provenance record is `EVIDENCE/web-provenance.json`; its pinned snapshot hashes remain external evidence and are not runtime dependencies.

## Native translation

Home-local tokens live in `src/theme/home.ts`. They do not change shared color or component defaults. Active-league Home now uses:

- a fixed, clipped dark ink-to-navy aurora and rink atmosphere behind scrolling content;
- an editorial `LEAGUE HOME` header and wrapping league name;
- the pinned translucent glass surface, top/bottom gradient, and blue-tinted border values during normal rendering;
- opaque `#0c1b31` / `#0a1628` fallbacks only when Reduce Transparency is enabled;
- Home-specific white/slate text hierarchy and tenant/status accents;
- a matchup stage with fully wrapping real next-game teams and venue, time, availability summary, and the existing game destination;
- native cards for schedule and league-site actions;
- a stacked compact matchup below 390 points, unlimited identity wrapping, smaller team marks, and a 19px compact league heading to avoid mid-word breaks;
- explicit compact team-row sizing (`flexGrow: 0`, `flexShrink: 0`, `flexBasis: 'auto'`) so React Native Web measures each wrapped identity at its intrinsic height instead of collapsing it through flex shorthand;
- a Home-only `GameCard` editorial variant for Recent Results that removes the cyan shadow and one-line clipping while leaving the default variant unchanged elsewhere;
- minimum 44-point interactive targets;
- opaque surfaces and stronger strokes when Reduce Transparency is enabled;
- zero-duration Home reveals and no decorative glow when the corresponding accessibility settings are enabled.

No photo or rink bitmap was added: no suitable existing native rink image was available, and remote assets were intentionally not fetched. The atmosphere is built from native gradients and line geometry only.

## States covered

Automated coverage includes active-league loading, enabled-effect data hydration and final rerenders, resolved next game, no upcoming game, recent final scores/status, all three check-in selections, failed check-in rollback, guest gating, unlimited long league/team/venue labels at 320/375 widths, notification/schedule/game/site destinations, reduced transparency, reduced motion, and the exact no-active-league marketplace return props. The static no-effect render test is a focused presentation seam and is not described as full mounted React coverage.

## Local validation and remaining device checks

- The earlier unclamped-label build overlapped at 320px; `EVIDENCE/browser-overlap-red/results.json` records the intersecting date/team/venue rectangles and `tdd-browser-overlap-red.log` records the failed geometry assertion. After the compact row fix, the parent ran the unchanged geometry checker outside the Codex sandbox: `tdd-browser-overlap-green.log` and `browser-geometry-green/results.json` pass. Final `browser-final/results.json` passes all eight fixture/viewport cases, including ordered non-overlapping text, unclamped identities, 44-point controls, action destinations, no horizontal overflow, fixed backdrop during scrolling, and zero external requests/uncaught exceptions.
- The parent visually reviewed the actual-source React Native Web screenshots. This verifies offline component composition, not full-app auth, native-device layout or live data. Native-specific adapters/providers use explicit local fixtures; no production fixtures or demo routes were added.
- No physical iOS/Android device, signed build, TestFlight, EAS, deployment, or backend acceptance is claimed.
- Native font rendering and safe-area behavior should be reviewed at 320, 375, 390, and 430 points on representative devices.
- This slice changes active-league Home only; marketplace and every other screen retain the accepted build15 implementation.
- React Native Web reports nested-button warnings for the pre-existing next-game outer `Pressable` plus inner check-in `Pressable` structure. The same warnings are present in `EVIDENCE/browser-baseline/results.json`; restructuring those accepted action semantics is outside this visual correction.
