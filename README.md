# Geo Learning Tools

Four browser apps for learning world geography, with spaced repetition that
keeps track of what you know and brings back what you don't.

**Live site:** <https://ugerhard-git.github.io/geo-learning-tools/>

| App                | What you practise                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Flag Atlas**     | Every UN member and observer state, plus the territories that fly their own flags.       |
| **Flag Atlas Map** | The same countries on a zoomable world map: name the one highlighted, or find it.        |
| **City Atlas**     | 2,738 cities and 4,596 regions — capitals, regional capitals, every city over a million. |
| **Terrain Atlas**  | 2,121 physical features: rivers, ranges, deserts, seas, straits, islands and peaks.      |

The landing page shows what is due for review in each app. Progress is kept in
your browser only; nothing is sent anywhere.

## Running it locally

You need Node.js 22 or later.

```sh
npm install
npm start        # builds the site and serves it on http://127.0.0.1:4173/
```

## Checks

```sh
npm run lint     # Prettier formatting and ESLint
npm run build    # builds dist/ and checks every page has its security policy
npm test         # browser tests (run `npx playwright install chromium` once first)
```

The same checks run on every pull request, and a merge to `main` deploys the
site to GitHub Pages only once they pass. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how the repository is put together.

## Project layout

```
public/      the four apps and the landing page, as single self-contained HTML files
tools/       build script and a small local web server
test/e2e/    Playwright browser tests
.github/     CI and deployment workflow, Dependabot configuration
licenses/    licences for the bundled fonts
```

## Data and credits

The apps are built on openly licensed data. Map geometry and places are
baked into the apps; facts in the detail panels are fetched live.

| Source                                                                                                                                | Used for                                         | Licence                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| [Natural Earth](https://www.naturalearthdata.com/)                                                                                    | Country, region and feature outlines; cities     | Public domain                       |
| [CIA World Factbook](https://github.com/factbook/factbook.json)                                                                       | Geography facts in Flag Atlas Map                | Public domain                       |
| [Wikidata](https://www.wikidata.org/)                                                                                                 | Facts in the detail panels, flag adoption dates  | CC0                                 |
| [Wikipedia](https://en.wikipedia.org/)                                                                                                | Article summaries, linked in each panel          | CC BY-SA 4.0                        |
| [REST Countries](https://restcountries.com/)                                                                                          | Capital, population, currency (optional API key) | Per their terms                     |
| [flagcdn.com](https://flagcdn.com/)                                                                                                   | Flag images                                      | Per their terms                     |
| [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/), [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) | Typefaces                                        | SIL OFL 1.1 ([licences](licenses/)) |

## Licence

The code is released under the [MIT licence](LICENSE). Data and fonts keep
the licences listed above.
