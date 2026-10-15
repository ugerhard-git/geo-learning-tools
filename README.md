# Geo Learning Tools

Four browser apps for learning world geography, with spaced repetition that
keeps track of what you know and brings back what you don't.

**Live site:** <https://ugerhard-git.github.io/geo-learning-tools/>

| App                           | What you practise                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| **Flags**                     | Every UN member and observer state, plus the territories that fly their own flags.       |
| **Countries and Territories** | The same countries on a zoomable world map: name the one highlighted, or find it.        |
| **Cities and Regions**        | 2,738 cities and 4,596 regions — capitals, regional capitals, every city over a million. |
| **Terrain**                   | 2,121 physical features: rivers, ranges, deserts, seas, straits, islands and peaks.      |

The landing page shows what is due for review in each app. Progress is kept in
your browser only and is never sent anywhere. Opening a place's details asks
Wikipedia, Wikidata or REST Countries about that place, and nothing more.

## Running it locally

You need Node.js 22 or later.

```sh
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
```

The same checks run on every pull request, and a merge to `main` deploys the
site to GitHub Pages only once they pass. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how the repository is put together.

## Project layout

```
src/                 the site, exactly as it is served (the build copies it to dist/)
  index.html         landing page, with landing/ for its script and styles
  flags/        one folder per app: index.html, app.js, app.css, and the
  countries/      app's own modules (data decoding, drill rules)
  cities/
  terrain/
  shared/            code and styles every app uses: map view, drills, spaced
                       repetition, progress screen, outside services …
  data/              map outlines, places and features (see docs/data.md)
  fonts/ icons/
  *.html             forwarding pages for the apps' old single-file addresses
tools/               build script, local web server, data generators (tools/data/)
test/unit/           Node tests of the shared modules, the drill rules and the data
test/e2e/            Playwright browser tests, one file per app plus smoke tests
docs/                how the code is put together, and where the data comes from
.github/             CI and deployment workflow, Dependabot configuration
licenses/            licences for the bundled fonts
```

The pages are plain HTML, CSS and JavaScript modules; there is no bundler and
nothing to compile. [docs/architecture.md](docs/architecture.md) explains how
the shared modules fit together.

## Data and credits

The apps are built on openly licensed data. Map geometry and places are
served with the site; facts in the detail panels are fetched live.

| Source                                                                                                                                | Used for                                         | Licence                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| [Natural Earth](https://www.naturalearthdata.com/)                                                                                    | Country, region and feature outlines; cities     | Public domain                       |
| [CIA World Factbook](https://github.com/factbook/factbook.json)                                                                       | Geography facts in Countries and Territories     | Public domain                       |
| [Wikidata](https://www.wikidata.org/)                                                                                                 | Facts in the detail panels, flag adoption dates  | CC0                                 |
| [Wikipedia](https://en.wikipedia.org/)                                                                                                | Article summaries, linked in each panel          | CC BY-SA 4.0                        |
| [REST Countries](https://restcountries.com/)                                                                                          | Capital, population, currency (optional API key) | Per their terms                     |
| [flagcdn.com](https://flagcdn.com/)                                                                                                   | Flag images                                      | Per their terms                     |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/), [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) | Typefaces                                        | SIL OFL 1.1 ([licences](licenses/)) |

## Licence

The code is released under the [MIT licence](LICENSE). Data and fonts keep
the licences listed above.
