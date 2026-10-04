# Native mobile UI first-pass verification

## Scope and baseline

- Baseline: `940f79d6ea4b5d5c55fdafe61d477547ea1680ff` (`production`).
- Delivery branch: `feat/mobile-ui-rebuild`; draft/review only.
- Initial source restyle: Splash, Login, Sign Up, Forgot Password, Home, and shared visual/navigation components.
- Inventory verifier: 26 screen files and 37 navigation registrations.
- Source/authentication/database identity is preserved. No native signing, TestFlight upload or App Store submission was performed.

## Executed checks

All commands ran from the isolated mobile worktree after the runtime and accessibility fixes.

- `corepack pnpm --filter @hockey-life/mobile test:ui-rebuild`: **21 passed, 0 failed**. Includes real-component TSX behavioral tests for game labels/action payloads; mocked boundaries in those tests are explicitly test-only.
- `corepack pnpm --filter @hockey-life/mobile test:rebuild`: **7 passed, 0 failed**. Missing/orphan routes/screens and dishonest acceptance cases are tested.
- `corepack pnpm --filter @hockey-life/mobile rebuild:verify`: **26 screens / 37 registrations validated**.
- `corepack pnpm exec turbo type-check --force`: **passed** across the workspace, including mobile.
- Mobile ESLint: **0 errors, 156 warnings**. This is not a lint-warning cleanup; warnings remain in the inherited application. No lint gate was weakened for application code. CommonJS-only tooling declares a narrow CommonJS import-rule exception.
- Frozen-lockfile installation: **passed**.
- Expo production web export: **passed**.
- Expo iOS JavaScript/Hermes export: **passed**. **This is not an Xcode native build or signed-device verification.**
- Production baseline comparison: web app source, original Auth/League contexts, mobile API/query code, app/EAS identity, signing metadata and the separate SwiftUI prototype are unchanged.
- Parsed lockfile comparison: only the mobile importer and its native UI package's React peer resolution changed; no web-app importer changed.

## Browser review

Playwright exercised the actual exported app, using the existing public backend configuration and an unsigned guest session. No signed-in session was fabricated and no production account/payment/registration mutations were made. The run produced 11 screenshots and passed **16 layout/navigation assertions**:

- Login, recovery and sign-up compositions.
- Login/sign-up at 320-pixel width, plus a compact 320-pixel guest view.
- 390-pixel guest Home/global marketplace, Schedule, Stats, Discover and Profile navigation.
- Exact tab selected-state checks and actual document width compared with the configured viewport, not an overflow-expanded `innerWidth`.
- **0 uncaught browser JavaScript errors.**

Screenshots are in this directory: [Login](login-390.png), [Sign up](signup-390.png), [Guest global view](guest-global-390.png). These are **Expo Web approximations**, not simulator/iPhone screenshots.

An initial real boot failure from an optional React Native Web accessibility API was reproduced, repaired and regression-tested. A real horizontal-overflow test also failed before the atmosphere clipping fix and passed afterward.

## Independent source review

The full independent review found two introduced accessible-name regressions: GameCard omitted venue/scores and the Home next-game instruction replaced the factual summary. A separate fix agent restored descendant-text aggregation, retained the instruction as a hint where appropriate, and added failing-then-passing executable component tests.

Final independent re-review of those fixes: **passed**, with no remaining security or logic blockers in the reviewed delta. The reviewer independently reran 21 UI tests and mobile type-check, inspected React Native's label-fallback implementation, and bound the verdict to unchanged SHA-256 hashes of both corrected source files. Physical iOS/VoiceOver acceptance remains pending. Do not interpret this record as Apple/device acceptance.

## Existing limitations and remaining acceptance

- Discover still makes an existing failing request: HTTP 400 / PostgreSQL `42703`, `column leagues.province does not exist`. Its implementation is byte-identical to the production baseline. This is recorded in the rebuild backlog, not hidden as a healthy empty state.
- A guest global marketplace render is not proof of selected-league/member Home behavior. The prior guest Home game-loading limitation remains unresolved.
- Reviewer account login, authenticated/team/captain flows, recovery link round-trips, account deletion and permissions require dedicated functional acceptance.
- Native compilation, signing, real-device VoiceOver/focus behavior, keyboard/safe-area behavior, fonts/dynamic type, notification/calendar permissions and SDK/package alignment still need testing on Nick's Xcode/device setup.
- The visual reference available here is Matt's approved **web** direction. Separate final mobile mockups were not supplied/found; these layouts remain provisional.
- Every screen stays `pending` until its documented browser/native acceptance is actually completed. No screen is marked accepted merely because it compiles or has a screenshot.

This is a verified starting branch for the redesign, not a claim that the complete app is ready for release.
