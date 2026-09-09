# Native mobile UI — first-pass review

This is an isolated first pass in the existing Expo/React Native app, **not** a new Apple app, production release, or accepted mobile design.

## Scope

- Branch: `feat/mobile-ui-rebuild`, based on production `940f79d6ea4b5d5c55fdafe61d477547ea1680ff`.
- Existing `apps/mobile` retained; `apps/ios` sample target is untouched.
- Deliberate source styling pass: Splash, Login, Sign Up, Forgot Password, and Home; shared atmosphere, card surfaces, navigation and accessibility preferences.
- All other screens remain in the [coverage checklist](../MOBILE-UI-REBUILD-CHECKLIST.md). A shared color change is not a completed screen redesign.
- [Executed checks and explicit limits](VERIFICATION.md) record automated results and the remaining native/device gates.
- [Design brief](../MOBILE-UI-DESIGN-BRIEF.md): native interpretation of the approved web direction. Separate mobile/Figma layouts were not available; exact mobile approval is still pending.

## Actual rendered screenshots

These are **Expo Web / Chromium composition previews**, not screenshots from a physical iPhone. The Apple sign-in button is native-iOS-specific and therefore not shown in the browser render.

- [Login — 390px](login-390.png)
- [Sign up — 390px](signup-390.png)
- [Guest global view — 390px](guest-global-390.png) — inherited marketplace, **not** a completed redesign of that screen.

The browser was connected using the existing project's public anonymous client configuration. No authenticated account, signup, reset email, check-in, or other production write was performed. The browser harness blocked external non-read methods; none were attempted.

## Acceptance limits

Source implementation, basic browser rendering, full role/state testing, and physical-iOS acceptance are separate gates. The manifest intentionally leaves all screen acceptance pending. Login/provider errors, signup/reset success, member/captain data states, real keyboard/Dynamic Type, VoiceOver, safe areas, permissions, deep links and device performance still need dedicated validation.

Known pre-existing blockers remain visible:

- Discover returns HTTP 400 / PostgreSQL `42703`: `column leagues.province does not exist`. The query source is unchanged from the base commit. The existing global league directory uses a different path and does populate.
- Guest league Home does not fetch games without a signed-in user; a working guest-entry button alone does not resolve Apple's previous rejection.
- Apple reviewer authentication, account deletion, native SDK/dependency alignment, push permissions and other release-readiness items remain separate work.

No App Store/TestFlight upload, signing, Apple identity change, web deployment or production merge was performed. Nick's existing authorized Xcode signing context can be used later; Apple-account setup is not a prerequisite for this UI branch.

## Local review

From the repo root, with the existing public mobile configuration available in an ignored local env file:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @hockey-life/mobile web
corepack pnpm --filter @hockey-life/mobile test:ui-rebuild
corepack pnpm --filter @hockey-life/mobile test:rebuild
corepack pnpm --filter @hockey-life/mobile rebuild:verify
corepack pnpm --filter @hockey-life/mobile type-check
```

`web` is a development composition preview. `ios` requires a working Xcode/simulator setup. Never put service-role keys in the mobile app.
