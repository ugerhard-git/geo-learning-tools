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

## Code for people

The code is read by the owner and by developers who don't know the project.
Write it so they can follow it without help.

- **Clear before clever.** Choose the plain version over the shortest or
  fastest one, unless the speed matters and a comment says why.
- **Every file explains itself.** Start with a short comment on what the file
  does. In an app's `app.js`, also describe the flow from loading the data to
  a drill, and what each of the app's own modules is for.
- **Comments say why, not what.** Explain decisions, sources and edge cases
  ("Box 1 waits zero days, so a miss comes back at once"); the code already
  shows what it does.
- **Small modules with one job each.** Data decoding, drawing and the page
  are kept apart, and functions that only compute have no side effects, so
  they can be tested in `test/unit/`.
- **Names a reader understands:** whole words, matching the interface where
  possible, no private abbreviations. Stored names are the exception: keys
  like `flagatlas.progress.v1` keep their old spelling (see "Things that must
  not break").
- **JSDoc types** on exported functions and shared data shapes, so editors can
  help.
- **Follow the existing patterns.** Reuse `src/shared/` before writing
  something new, and move code there once a second app needs it.
- **No new tools without a reason.** Every dependency or build step is one
  more thing to learn; propose it to the owner first. The build must keep
  using only Node's built-in modules, so the published site is built without
  third-party packages (see the `build-pages` job in
  `.github/workflows/ci.yml`).
- **Keep the documentation true.** When the code changes, update its comments,
  `README.md`, `docs/architecture.md` and `docs/data.md` in the same pull
  request.

## Interface text

Plain language for learners, in sentence case ("Name the region", not "Name
The Region"), with no jargon. This covers buttons, hints, drill prompts,
messages, errors and the progress screen: say what happened and what to do
("The flags could not be loaded. Check your connection and reload."), not how
the code works.
