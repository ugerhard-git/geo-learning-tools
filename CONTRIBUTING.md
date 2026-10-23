# Contributing

## Setup

```sh
npm install
npx playwright install chromium   # once, for the browser tests
```

In VS Code, install the recommended extensions when asked; the README's
"Editor setup" section explains the rest.

## Day-to-day commands

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm start`         | Build and serve the site on <http://127.0.0.1:4173/> |
| `npm run build`     | Build `dist/` and run the build checks               |
| `npm run lint`      | Check formatting (Prettier) and lint (ESLint)        |
| `npm run format`    | Rewrite files to Prettier's formatting               |
| `npm run test:unit` | Run the unit tests (Node only, no browser)           |
| `npm test`          | Run the browser tests against `dist/` (build first)  |

If you already have a Chromium build installed, point the tests at it instead
of downloading one: `PW_CHROMIUM_PATH=/path/to/chrome npm test`.

## Where things go

The site is in `src/`, served as it is: plain HTML, CSS and JavaScript
modules, no bundler. [docs/architecture.md](docs/architecture.md) describes
the shared modules and how an app is put together;
[docs/data.md](docs/data.md) describes the data files.

Every change to what a learner sees or does needs a browser test in
`test/e2e/`; every change to shared logic or data a unit test in
`test/unit/`.

## Code for people

The code is read by the owner and by developers who don't know the project.
Write it so they can follow it without help.

- **Clear before clever.** Choose the plain version over the shortest or
  fastest one, unless the speed matters and a comment says why.
- **Every file explains itself.** Start with a short comment on what the file
  does. In an app's `app.js`, also describe the flow from loading the data to
  a drill, and what each of the app's own modules is for.
- **Comments say why, not what.** Explain decisions, sources and edge cases
  (a browser quirk, a data oddity, a security concern; "Box 1 waits zero
  days, so a miss comes back at once"); the code already shows what it does.
- **Small modules with one job each.** Data decoding, drawing and the page
  are kept apart. An app's own rules (what a drill asks, what counts as
  right) go in a module with no page access, so they can be unit-tested.
- **Names a reader understands:** whole words, matching the interface where
  possible, no private abbreviations. Stored names are the exception: keys
  like `flagatlas.progress.v1` keep their old spelling (see "Ground rules").
- **JSDoc types** on exported functions and shared data shapes, so editors can
  help.
- **Follow the existing patterns.** Reuse `src/shared/` before writing
  something new, and move code there once a second app needs it, with a
  module comment saying what it is for.
- **No new tools without a reason.** Every dependency or build step is one
  more thing to learn; propose it before adding it. The build must keep using
  only Node's built-in modules, so the published site is built without
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

## Pull requests

- **Discuss bigger changes first**, in an issue or with the owner, before
  building them.
- **Run the checks** before opening one:

  ```sh
  npm run lint
  npm run test:unit
  npm run build       # also runs the security checks on every page
  npm test
  ```

- **Describe what changed and how it was tested.** For visual changes,
  include before/after screenshots.
- **Start from the latest `main`.** Once a pull request is merged, start the
  next change on a new branch rather than adding to the merged one.
- The owner reviews and merges.

## How changes reach the site

1. Open a pull request. CI checks formatting, lints, runs the unit tests,
   builds, and runs the browser tests.
2. Once it is merged into `main`, the same workflow runs again and, if every
   check passes, deploys `dist/` to GitHub Pages.

There is no other route to the live site, so anything that can break it
should be covered by a test.

## Ground rules

- **Show where every fact comes from.** Whatever an app shows or drills on
  (a fact, a drawing, a word, a map, a figure) names its source where the
  learner sees it, as a link wherever one exists, so they can check it
  themselves. Name what was copied and under which licence (an author and
  licence for each Commons file, for example), and say when something rests
  on a weaker source (a rule for a whole region, a community guide) or has
  none: "No solid source yet" is better than a guess. Data written for this
  project says so. A new data file lists its sources in `docs/data.md`.

- **No third-party scripts, stylesheets or fonts at runtime.** Everything the
  pages execute is served from this repository. Each page's
  Content-Security-Policy enforces this, and the build fails if a page has
  none.
- **Nothing inline.** No `<script>` bodies, `<style>` elements, `style=""`
  attributes or `on…=""` handlers: the policy refuses them, and so does the
  build. Use a class, or set a computed style from script
  (`el.style.width = …`).
- **Don't loosen the policy to make a change work.** A new outside service
  goes into the page's policy and into the allowed list in
  `tools/site-checks.mjs`, and should be discussed first. `SECURITY.md` lists
  the known limits.
- **Saved progress must keep working.** Do not rename a storage key, change
  an item's progress key or change the record format; the table in
  `docs/architecture.md` lists them. This holds when an app is renamed, too.
- **Old addresses keep working.** When an app moves, its old address
  forwards to the new one (see the forwarding pages in `src/`).
- **Outside data is untrusted.** Anything fetched from Wikipedia, Wikidata or
  REST Countries, and anything read back from localStorage, is validated and
  escaped before it reaches the page.
- **Progress stays in the browser.** Answers and progress are never sent
  anywhere. The only requests to other sites are lookups of the place being
  shown, to the services the policy allows.

## Recommended repository settings

These live in the GitHub settings rather than in files, so they are listed
here:

- **Pages:** source set to "GitHub Actions".
- **Branch protection on `main`:** the ruleset "Protect main" (Settings →
  Rules → Rulesets) set to **Active**, requiring a pull request and the
  "Lint, build and test" check. Without it, anything that can push to the
  repository can push to `main` directly: a person, a leaked token, or a
  workflow job with write access, such as the one that commits flag colours.
  Such a push would still deploy only after the checks passed, since the
  deployment job depends on them, but nobody would have reviewed it.
- **Dependabot security updates:** on (Settings → Code security), so a
  vulnerable dev tool gets a pull request as soon as it is known, not only in
  the weekly round.
- **Environment `github-pages`:** restrict deployments to the `main` branch.
