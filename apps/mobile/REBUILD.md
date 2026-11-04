# Native Mobile UI Rebuild

This directory is the existing Expo 54 / React Native 0.81.5 Supabase app. The rebuild changes presentation incrementally while preserving native behavior, route contracts, auth/data access, permissions, and app identifiers. `apps/ios` is a different SwiftUI sample target and must not be used for this work.

## Canonical startup

From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @hockey-life/mobile start:clear
```

Then choose an Expo target. Use `corepack pnpm --filter @hockey-life/mobile web` for a quick composition review, `corepack pnpm --filter @hockey-life/mobile ios` for the iOS simulator, or scan the Expo development QR code for a configured native device. The app expects its existing public Expo/Supabase environment configuration. Keep local configuration ignored by Git and never use a service-role key in the mobile app.

Web preview is useful for hierarchy, responsive width, copy, and obvious visual regressions. It is not evidence for native safe-area behavior, keyboard handling, haptics, notification permissions, Apple authentication, secure storage, image picking, deep links, accessibility behavior, or physical-device performance.

## Inventory and deterministic checks

The canonical machine-readable inventory is `src/rebuild/screen-manifest.json`. It covers every `src/screens/**/*Screen.tsx` file, every registration parsed from `App.tsx` and `src/navigation/index.tsx`, duplicate component registrations, role gates, contracts, interaction states, phase, acceptance tests, and explicit orphan status.

Run:

```sh
node --test apps/mobile/scripts/__tests__/verify-rebuild-manifest.test.cjs
node apps/mobile/scripts/verify-rebuild-manifest.cjs
node apps/mobile/scripts/generate-rebuild-checklist.cjs
corepack pnpm --filter @hockey-life/mobile type-check
```

The generator deterministically updates `docs/MOBILE-UI-REBUILD-CHECKLIST.md`. The verifier discovers filesystem screens and parses actual route registrations; it fails for omitted/removed screens or routes, duplicates, stale entries, and review/accepted statuses without the required evidence.

Equivalent app-scoped commands (run from the repo root):

```sh
corepack pnpm --filter @hockey-life/mobile test:ui-rebuild
corepack pnpm --filter @hockey-life/mobile test:rebuild
corepack pnpm --filter @hockey-life/mobile rebuild:verify
corepack pnpm --filter @hockey-life/mobile rebuild:checklist
```

## Review protocol

Keep a screen `pending` until the parent review. Set `sourceImplemented` only when that screen received a deliberate source pass. Set `browserReviewed` and move to `review` only after reviewing that screen and its required states in Expo web. Set `iosDeviceAccepted` and move to `accepted` only after recording physical-device/build evidence in `ownerNotes`. Regenerate the checklist after every manifest change.

The visual source is Matt's approved web **ExecSuite × Bold Beer-League Hybrid** direction: midnight rink atmosphere, translucent slate panels, electric blue/cyan, heavy system type, restrained glow, 18–24 radius cards, and dynamic league accents. Because no independent mobile/Figma spec was supplied, this remains a provisional native interpretation pending review.
