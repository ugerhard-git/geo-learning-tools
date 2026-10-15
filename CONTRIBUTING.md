# Contributing

## Setup

```sh
npm install
npx playwright install chromium   # once, for the browser tests
```

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

- Code used by more than one page goes in `src/shared/`, with a module
  comment saying what it is for and JSDoc on what it exports.
- An app's own rules (what a drill asks, what counts as right) go in a module
  of their own with no DOM access, so they can be unit-tested.
- Comments say why, not what. If a choice was made for a reason that is not
  obvious from the code (a browser quirk, a data oddity, a security concern),
  write the reason down beside it.
- Every change to what a learner sees or does needs a browser test in
  `test/e2e/`; every change to shared logic or data a unit test in
  `test/unit/`.

## How changes reach the site

1. Open a pull request. CI checks formatting, lints, runs the unit tests,
   builds, and runs the browser tests.
2. Once it is merged into `main`, the same workflow runs again and, if every
   check passes, deploys `dist/` to GitHub Pages.

There is no other route to the live site, so anything that can break it
should be covered by a test.

## Ground rules

- **No third-party scripts, stylesheets or fonts at runtime.** Everything the
  pages execute is served from this repository. Each page's
  Content-Security-Policy enforces this, and the build fails if a page has
  none.
- **Nothing inline.** No `<script>` bodies, `<style>` elements, `style=""`
  attributes or `on…=""` handlers: the policy refuses them, and so does the
  build. Use a class, or set a computed style from script
  (`el.style.width = …`).
- **Saved progress must keep working.** Do not rename a storage key, change
  an item's progress key or change the record format; the table in
  `docs/architecture.md` lists them.
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
- **Branch protection on `main`:** require a pull request, and require the
  "Lint, build and test" check to pass. Without it, a direct push to `main`
  would still deploy — but only after that same check passed, since the
  deployment job depends on it.
- **Environment `github-pages`:** restrict deployments to the `main` branch.
