# Working on this repository

Notes for Claude. The project's own rules are in `CONTRIBUTING.md`, and how
the code fits together is in `docs/architecture.md`; read both before
changing code.

## Pull requests

- **Check earlier pull requests first.** Before starting work for a new pull
  request, and before pushing to an existing branch, look at the state of
  every earlier pull request.
  - If one has been merged, start a new branch from the latest `main`. Never
    push to a branch whose pull request is already merged.
  - If one is still open, ask the owner whether to add to it or open a
    separate pull request.
- **The owner approves and merges.** Open pull requests; never merge them.
- **Plan first when asked.** When the owner asks to plan or discuss a change,
  agree on it before building.
- Describe in each pull request what changed and how it was tested. For
  visual changes, include before/after screenshots.

## Before every pull request

```sh
npm run lint        # Prettier and ESLint
npm run test:unit
npm run build       # also runs the security checks on every page
npm test            # Playwright browser tests
```

## Things that must not break

- **Saved progress.** Storage keys, progress keys and the record format stay
  as they are (see the table in `docs/architecture.md`), even when apps are
  renamed.
- **Old addresses.** When an app moves, its old address forwards to the new
  one.
- **The security policy.** Every page keeps the same Content-Security-Policy
  rules, enforced by `tools/site-checks.mjs`. Do not loosen it to make a
  change work. `SECURITY.md` lists the known limits.
