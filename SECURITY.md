# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/ugerhard-git/geo-learning-tools/security/advisories/new)
rather than in a public issue. Include what you found, how to reproduce it,
and which page it affects.

## What the apps protect

The apps are static pages with no server or accounts. The things worth
protecting are:

- **An optional REST Countries API key**, which a learner may choose to
  remember in their browser.
- **Learning progress** stored in the browser.
- **The integrity of the pages themselves**, which render text fetched from
  Wikipedia, Wikidata and REST Countries.

Every page carries a strict Content-Security-Policy that allows only scripts
and stylesheets served from the site itself, no inline code of any kind, and
network access only to the services listed in the README. The build refuses
a page that weakens it.

The build (`tools/build.mjs`, with the checks in `tools/site-checks.mjs`)
also refuses symbolic links, file types the site does not publish, and SVGs
that could run script. The site that is published is built in a CI job that
installs no npm packages, so the dev tooling never touches it.

The checks run inside Playwright's container image (browsers and their system
packages included), pinned to its digest in `.github/workflows/ci.yml`. It
holds only a read-only token, like the rest of the check job.

The "Language data" workflow works the same way, for the Scripts and
Languages data: its build job unpacks CLDR and the UDHR translations as data
(no npm package is installed) and fetches words from Wikidata, read-only;
its commit job installs nothing and checks the result with a built-ins-only
script before committing it.

The "Road signs" workflow works the same way: its fetch job reads Wikipedia
and Commons, read-only, and leaves out any drawing that could run script;
its commit job installs nothing, checks every drawing again with a
built-ins-only script (`tools/data/check-road-signs.mjs`) and commits them.
The app shows the drawings with `<img>`, which never runs script in them.

The "Flag colours" workflow measures flag colours with the dev tooling in a
read-only job. A second job, which installs nothing, checks the result with a
built-ins-only script and commits it, to a pull request's own branch (never
from a fork) or to a new branch when run by hand.

## Known limits

**The shared origin.** GitHub Pages serves every project site of an account
from one origin, `ugerhard-git.github.io`. Browsers treat everything on an
origin as one site, so any other project published from this account can:

- read and change the apps' localStorage: progress, caches and a remembered
  REST Countries key;
- capture a key held for one tab only, by opening an app in a window it
  controls;
- serve scripts that the apps' `script-src 'self'` would accept.

The apps validate everything they read back from storage, and the settings
dialog tells learners about the key. Only a domain of the site's own (a
custom domain for Pages) removes this limit; until then, nothing else
published from this account should run code its owner does not trust.

**Meta-tag policies.** GitHub Pages cannot send response headers, so the
policy is a `<meta>` tag. That cannot set `frame-ancestors`: other sites can
frame the pages. Settings that involve the API key, erasing and importing
are switched off inside a frame.

Answers from Wikipedia, Wikidata and REST Countries are tested as if they
were hostile: `test/e2e/hostile-answers.spec.js` fills every text they return
with markup and checks that each app shows it as plain text.

## Security reviews

| Date    | Scope                                                                       | Result                                                                                                                                          |
| ------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10 | Whole site, build, CI and tools                                             | Findings fixed in the pull request "Security audit: findings and fixes"                                                                         |
| 2026-10 | Second review, after the rename, the editor setup and the flag colour codes | Findings fixed in the pull request "Second security audit: findings and fixes"; two repository settings left to the owner (see CONTRIBUTING.md) |
