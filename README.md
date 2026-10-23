# Geo Learning Tools

Five browser apps for learning world geography, with spaced repetition that
keeps track of what you know and brings back what you don't.

**Live site:** <https://ugerhard-git.github.io/geo-learning-tools/>

| App                           | What you practise                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Flags**                     | Every UN member and observer state, plus the territories that fly their own flags.                                                               |
| **Countries and Territories** | The same countries on a zoomable world map: name the one highlighted, find it, or find it from its internet domain or currency.                  |
| **Cities and Regions**        | 2,738 cities and 4,596 regions — capitals, regional capitals, every city over a million.                                                         |
| **Terrain**                   | 2,121 physical features: rivers, ranges, deserts, seas, straits, islands and peaks.                                                              |
| **Scripts and Languages**     | The official languages of the 120 Street View countries: telltale letters, look-alike scripts, and which language or country a sentence is from. |
| **Roads**                     | What the roads of the Street View countries give away: driving side, centre line colour, and stop, crossing, chevron and warning signs.          |

The landing page shows what is due for review in each app. Progress is kept in
your browser only and is never sent anywhere. Opening a place's details asks
Wikipedia, Wikidata or REST Countries about that place, and nothing more.

## Running it locally

You need Node.js 22 or later (`.nvmrc` names the version CI uses).

```sh
nvm use          # optional: switch to the version in .nvmrc
npm install
npm start        # builds the site and serves it on http://127.0.0.1:4173/
```

The pages load their code as JavaScript modules and their maps as data files,
which browsers only allow over HTTP, so open them through the server rather
than straight from disk.

## Checks

```sh
npm run lint       # Prettier formatting and ESLint
npm run test:unit  # unit tests of the shared modules, the drills and the data files (Node only)
npm run build      # builds dist/ and checks every page against the security rules
npm test           # browser tests (run `npx playwright install chromium` once first)
npm run format     # rewrite files to Prettier's formatting
```

To run the browser tests with a Chromium you already have, set
`PW_CHROMIUM_PATH=/path/to/chrome`.

The same checks run on every pull request, and a merge to `main` deploys the
site to GitHub Pages only once they pass. On a new copy of the repository,
set **Settings → Pages → Build and deployment → Source** to "GitHub Actions"
once. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how the repository is put together.

## Editor setup

The repository comes with settings for [VS Code](https://code.visualstudio.com/):

- **Extensions:** opening the folder offers the recommended ones
  (`.vscode/extensions.json`): ESLint, Prettier, EditorConfig, Playwright Test,
  GitHub Actions and a spell checker.
- **Formatting:** files are formatted with Prettier when you save, and ESLint
  applies its safe fixes, so they pass `npm run lint` before you push.
  `dist/` opens read-only, as a reminder to edit `src/` instead.
- **Debugging:** **F5** builds the site, starts the local server and opens
  Chrome with the debugger attached. Breakpoints set in `src/` work, because
  the server serves an exact copy. After changing a file, press F5 again (or
  run the "build" task) and reload the page.
- **Tasks:** **Terminal → Run Task** has start, build, lint, unit tests and
  browser tests. The Testing view runs the Playwright tests one by one; build
  first, since they test `dist/`.
- **IntelliSense:** `jsconfig.json` gives completions and hover docs from the
  JSDoc comments. Type checking is opt-in: add `// @ts-check` at the top of a
  file to see type errors in it.

Other editors pick up the basics from `.editorconfig` and `.prettierrc.json`.

## Project layout

```
src/                 the site, exactly as it is served (the build copies it to dist/)
  index.html         landing page, with landing/ for its script and styles
  flags/             one folder per app (see "Anatomy of an app" below)
  countries/
  cities/
  terrain/
  languages/
  roads/
  shared/            code and styles every app uses: map view, drills, spaced
                       repetition, progress screen, outside services …
  data/              map outlines, places and features (see docs/data.md)
  fonts/ icons/
  flag-atlas/ …      forwarding pages for the apps' old addresses, and *.html
                       for their older single-file ones
tools/               build script, local web server, data generators (tools/data/)
test/unit/           Node tests of the shared modules, the drill rules and the data
test/e2e/            Playwright browser tests, one file per app plus smoke tests
docs/                how the code is put together, and where the data comes from
.github/             CI and deployment workflow, Dependabot configuration
.vscode/             editor settings, tasks and debugging (see "Editor setup")
licenses/            licences for the bundled fonts and the Unicode data
```

The pages are plain HTML, CSS and JavaScript modules; there is no bundler and
nothing to compile. [docs/architecture.md](docs/architecture.md) explains how
the shared modules fit together, with a table of what each one is for.

## Anatomy of an app

Every app folder has the same entry files, plus modules that split the work
by concern:

```
src/cities/
  index.html   markup and the Content-Security-Policy
  app.css      the app's own styles, on top of src/shared/*.css
  app.js       the page: map, panel, drill setup, progress. Start reading here
  data.js      reads the app's data file into places and outlines
  drills.js    what each drill asks and what counts as right (no page access)
```

`app.js` opens with a comment that explains how the app runs, from loading
the data to a drill, and what each of its files is for. The apps share their
building blocks: the map view, the detail panel, the drill bar, spaced
repetition and the progress screen are in `src/shared/`. Once you know one
app, the others read the same way. Logic that only computes, such as drill
rules, parsing and distances, has no page access, so it is unit-tested.

Every page keeps a strict Content-Security-Policy that names exactly the
outside services it may contact. A new data source means adding its host to
the page's policy and to the list in `tools/site-checks.mjs`, or the build
fails. Adding a whole app is described in
[docs/architecture.md](docs/architecture.md#adding-an-app).

## The data files

The map outlines, cities, regions and physical features in `src/data/` are
generated from Natural Earth by the scripts in `tools/data/`, which are run by
hand when the source data changes. The flags' colour codes are measured from
the flag drawings on Wikimedia Commons by the "Flag colours" workflow, and
the Scripts and Languages data is built from Unicode CLDR, the Universal
Declaration of Human Rights and Wikidata by the "Language data" workflow. [docs/data.md](docs/data.md) describes
each file's format and where it comes from.

## The REST Countries key

The detail panels can show a country's capital, population and currency from
REST Countries, which needs a free personal key. The key is never stored in
this repository or on the site. A learner pastes it into an app's settings.
It is kept for that tab only, or, if they tick "Remember", in their browser,
where every app on the site can use it.

REST Countries only answers pages from hostnames on the key's allowed list.
Add `ugerhard-git.github.io`, and `127.0.0.1` for local work, on the API Keys
page at restcountries.com.

## Security

The apps are static pages, so the main risks are outside data ending up as
code and third-party code running on the site. In short:

- **Nothing inline and nothing from elsewhere.** Every page allows scripts
  and styles from the site's own files only, and the build refuses a page
  that weakens its policy.
- **Outside data is untrusted.** Answers from Wikipedia, Wikidata and REST
  Countries, and anything read back from browser storage, are checked, cut to
  size and escaped before they reach the page.
- **Progress stays in the browser.** Nothing a learner answers is sent
  anywhere.
- **CI** runs with read-only permissions. The site is built in a job that
  installs no packages, and only the deploy job can publish. The one job that
  can write to the repository commits measured flag colours, installs
  nothing and checks the file first. Every action is
  pinned to a commit, and Dependabot proposes updates after a week's wait.

[SECURITY.md](SECURITY.md) has the details, the known limits (the site
shares its address with every other GitHub Pages site of the account), and
how to report a problem.

## Data and credits

The apps are built on openly licensed data. Map geometry and places are
served with the site; facts in the detail panels are fetched live.

| Source                                                                                                                                | Used for                                                                | Licence                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Natural Earth](https://www.naturalearthdata.com/)                                                                                    | Country, region and feature outlines; cities                            | Public domain                                                   |
| [CIA World Factbook](https://github.com/factbook/factbook.json)                                                                       | Geography facts in Countries and Territories                            | Public domain                                                   |
| [Wikidata](https://www.wikidata.org/)                                                                                                 | Facts in the detail panels, flag adoption dates, domains, phone codes   | CC0                                                             |
| [Wikipedia](https://en.wikipedia.org/)                                                                                                | Article summaries, linked in each panel                                 | CC BY-SA 4.0                                                    |
| [REST Countries](https://restcountries.com/)                                                                                          | Capital, population, currency (optional API key)                        | Per their terms                                                 |
| [flagcdn.com](https://flagcdn.com/)                                                                                                   | Flag images                                                             | Per their terms                                                 |
| [Wikimedia Commons](https://commons.wikimedia.org/)                                                                                   | Flag colour codes, measured from the flag drawings                      | Public domain                                                   |
| [Unicode CLDR](https://cldr.unicode.org/) 48.2                                                                                        | Languages: where they are official, scripts, letters, words; currencies | Unicode License v3 ([licence](licenses/unicode-license-v3.txt)) |
| [UDHR in Unicode](https://www.unicode.org/udhr/) via [udhr](https://github.com/wooorm/udhr)                                           | Sample sentences in each language                                       | UN OHCHR translations; package MIT                              |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/), [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) | Typefaces                                                               | SIL OFL 1.1 ([licences](licenses/))                             |

## Licence

The code is released under the [MIT licence](LICENSE). Data and fonts keep
the licences listed above.
