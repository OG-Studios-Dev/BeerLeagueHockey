# Repository workflow and release lineages

This repository has three active histories. They must not be force-converged, reset onto one another, or treated as interchangeable:

| Branch | Current role | Correct PR base |
| --- | --- | --- |
| `main` | Legacy/default integration branch. It is materially behind the shipped branches. | `main` only for work intentionally maintained on the legacy line. |
| `production` | Shipped web production line and Vercel production source. | `production` for web fixes and repository changes that must protect current web production. |
| `release/mobile-auth-env-fix` | Shipped Expo/React Native mobile line. iOS 1.0.0 build 33 was verified from this line. | `release/mobile-auth-env-fix` for shipped mobile fixes. |

`apps/mobile` is the shipped Expo/React Native application. `apps/ios` is an older, separate experimental native scaffold; its macOS smoke job is path-gated to real `apps/ios/**` changes. No EAS, Apple signing, submission, or cloud build belongs in ordinary repository CI.

## Safe change flow

1. Fetch the remote, identify the target product, and branch from the exact remote head for that product.
2. Work in a clean isolated clone or worktree. Never reuse or clean an unrelated dirty checkout.
3. Open a reviewed PR against the matching base above. Never push directly to `production` and never force-push any shared release branch.
4. Keep shared repository-only changes small enough to cherry-pick deliberately between divergent lines. Do not merge branches solely to copy housekeeping changes.
5. Require the Linux quality checks on all three branch targets. Mobile-only readiness tests run where the shipped mobile test files exist; the Hockey Life Times renderer tests run where that package exists.

## Preservation before cleanup

Branch, tag, worktree, or source deletion requires both preservation and proof:

1. Record the exact candidate head SHA and its owner/purpose.
2. Preserve local-only commits and dirty/untracked files in a recoverable backup outside the checkout.
3. For a merged branch, prove that its exact head SHA is represented by the merged PR; ancestry or age alone is insufficient.
4. Recheck the current remote head immediately before deletion. If it differs from the preserved/proved SHA, stop.
5. Treat local deletion, remote deletion, PR closure, and repository-setting changes as separate approvals.

Never reset or force-merge `main`, `production`, and `release/mobile-auth-env-fix` to manufacture alignment. Reconciliation is a reviewed product decision, not repository cleanup.
