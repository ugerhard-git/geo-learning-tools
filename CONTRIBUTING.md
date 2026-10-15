# Contributing

## Setup

```sh
npm install
npx playwright install chromium   # once, for the browser tests
```

## Day-to-day commands

| Command          | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `npm start`      | Build and serve the site on <http://127.0.0.1:4173/> |
| `npm run build`  | Build `dist/` and run the build checks               |
| `npm run lint`   | Check formatting (Prettier) and lint (ESLint)        |
| `npm run format` | Rewrite files to Prettier's formatting               |
| `npm test`       | Run the browser tests against `dist/` (build first)  |

If you already have a Chromium build installed, point the tests at it instead
of downloading one: `PW_CHROMIUM_PATH=/path/to/chrome npm test`.

## How changes reach the site

1. Open a pull request. CI checks formatting, lints, builds and runs the
   browser tests.
2. Once it is merged into `main`, the same workflow runs again and, if every
   check passes, deploys `dist/` to GitHub Pages.

There is no other route to the live site, so anything that can break it
should be covered by a test.

## Ground rules

- **No third-party scripts, stylesheets or fonts at runtime.** Everything the
  pages execute is served from this repository. Each page's
  Content-Security-Policy enforces this, and the build fails if a page has
  none.
- **Outside data is untrusted.** Anything fetched from Wikipedia, Wikidata or
  REST Countries is validated and escaped before it reaches the page.
- **Progress stays in the browser.** Nothing a learner does is sent anywhere.

## Recommended repository settings

These live in the GitHub settings rather than in files, so they are listed
here:

- **Pages:** source set to "GitHub Actions".
- **Branch protection on `main`:** require a pull request, and require the
  "Lint, build and test" check to pass. Without it, a direct push to `main`
  would still deploy — but only after that same check passed, since the
  deployment job depends on it.
- **Environment `github-pages`:** restrict deployments to the `main` branch.
