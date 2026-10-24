# How the code is put together

The site is seven static pages: a landing page and six apps. There is no
server-side code and no build step beyond copying `src/` to `dist/` and
checking it (see `tools/build.mjs`). Every page is plain HTML that loads
stylesheets and one JavaScript module, and that module imports the rest.

```
src/
  index.html            landing page          → landing/landing.js
  flags/                a grid of flags       → app.js, design.js
  countries/            countries on a map    → app.js, wikidata-facts.js
  cities/               cities and regions    → app.js, data.js, drills.js
  terrain/              physical features     → app.js, data.js, drills.js
  languages/            scripts and languages → app.js, data.js, drills.js, map.js
  roads/                roads and road signs  → app.js, data.js, drills.js
  shared/               everything used by more than one page
  data/                 map and place data, loaded at run time
```

## The shared modules

Each app's `app.js` puts the shared pieces together and adds what only that
app does. The shared modules, from the bottom up:

| Module             | What it is for                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `dom.js`           | `$`, `$$`, `esc` (escape for HTML), `table` (lookup without a prototype), number formatting                     |
| `storage.js`       | localStorage that never throws; `ttlCache` for answers from outside services                                    |
| `net.js`           | `getJSON` for outside services (no cookies, no referrer, no redirects), `loadData` for `src/data/`, `FRAMED`    |
| `random.js`        | `randomInt`, `shuffle`, `pickOne`, from the platform's cryptographic generator                                  |
| `text.js`          | Judging typed answers: `answerKey`, `editDistance`, `typoAllowance`, `judgeTyped`                               |
| `codec.js`         | Decoding the packed coordinates in `src/data/`, and turning rings into SVG paths                                |
| `geo.js`           | Distances, compass bearings, point-in-shape, nearest point on an outline, areas                                 |
| `projection.js`    | Equal Earth and Mercator, and the setting that remembers which one the learner picked                           |
| `countries.js`     | The country table (`src/data/countries.txt`), regions and statuses                                              |
| `land.js`          | Country outlines for the Cities and Terrain maps (`land.json`)                                                  |
| `world.js`         | The more detailed outlines the flag apps draw (`world.json`)                                                    |
| `regions.js`       | First-level region outlines (states, provinces), decoded on demand: Cities and Regions, and Languages' maps     |
| `mapview.js`       | `MapView`: the visible window onto the map, pan, pinch, wheel and keyboard, animated moves                      |
| `overlay.js`       | `MarkerLayer`: rings, pins and guess lines that keep their size on screen                                       |
| `map-ui.js`        | Drawing the land, the projection switch, the tooltip                                                            |
| `panel.js`         | `DetailPanel`: the panel of facts over the map, and returning to a drill when it closes                         |
| `flags.js`         | Flag images from flagcdn.com, hidden if they cannot load                                                        |
| `leitner.js`       | Spaced repetition: `ProgressStore` (records, import, export), `planSession`, `createPicker`                     |
| `drill.js`         | `DrillSession`: the question bar, choices, typed answers, hints, keyboard shortcuts and the end-of-session card |
| `progress-ui.js`   | `ProgressView`: the progress screen, and the export/import dialog                                               |
| `restcountries.js` | The optional REST Countries key, its settings dialog, requests and cache                                        |
| `wikidata.js`      | Requests to Wikidata, Wikipedia and the Wikidata query service                                                  |

Stylesheets follow the same split: `tokens.css` (colours, fonts, both themes),
`base.css` (page frame, buttons, text), `map.css`, `drill.css`,
`progress.css` and `dialog.css`. Each page links the ones it uses, then its
own `app.css`, which adds and overrides.

### A map app

Cities and Regions, Terrain, and Countries and Territories share one shape:

1. Load the data files (`loadData`), then draw the land into the SVG.
2. A `MapView` owns the SVG's `viewBox`. The app draws; the view only moves.
   After every move it calls `onChange`, where the app resizes markers and
   dots so they stay the same size on screen, and shows more cities as the
   map zooms in.
3. A click that was not a drag reaches the app through `onTap`: in explore
   mode it opens the detail panel; in a drill it is an answer.
4. Switching projection redraws everything from longitude/latitude, so it
   costs a redraw, not a reload.

Scripts and Languages is not a map app, but uses the same pieces for its map
drill: the map shows only during that drill, under the writing and the
question bar, and a click is judged against the outlines of where the
language is used (`languages/map.js`). A language's details draw a small,
fixed map of the same places.

Pinch zoom re-anchors the gesture whenever the number of fingers changes.
Without that, lifting one finger of a pinch makes the map jump, because the
pan would still be measured from where that finger first touched. See the
comment above `bindPointer` in `mapview.js`.

### A drill

Cities and Regions and Terrain run drills as sessions with `DrillSession`
(`drill.js`). The session holds the queue and the score, records each answer,
asks a missed item again a few questions later, and draws the question bar.
The app supplies hooks: `ask(item)` sets the map up and describes the
question; `reveal(item)` shows the answer; `judge(text)` checks a typed one.
The rules of each drill (prompts, which answers count, which wrong options to
offer) are pure functions in the app's `drills.js`, tested in
`test/unit/*-drills.test.js`.

The flag apps ask one question at a time with no session: `createPicker`
chooses the next item (mostly what is due, some new, never what was just
asked).

### Spaced repetition

Every item has a record `[box, dueDay, tries, wrong]` (`leitner.js`). A right
answer moves it up a box, a wrong one sends it back to box 1. Boxes wait 0,
2, 5, 12 and 30 days. A session plans about seven reviews to three new items
and fills up with what is due before anything that is not.

### Adding an app

Give it a folder under `src/` and a card in `src/index.html`. The card names
the app's progress key (`data-store`) and a short name for the "today" counts
(`data-short`); `data-total` or `data-breakdown` add totals or per-drill
counts. The cards sit two to a row, and an odd last card spans the row, so
the grid needs no change. Add the page to the smoke test in
`test/e2e/smoke.spec.js`.

## Rules the code keeps to

**Sources on screen.** Every fact, drawing, word or figure an app shows
names its source where the learner sees it, usually as a small line in the
details (`.src`), with a link wherever there is one. See "Ground rules" in
`CONTRIBUTING.md`.

**Nothing inline.** Each page's Content-Security-Policy allows scripts and
styles from the site's own files only (`script-src 'self'; style-src 'self'`),
with no `'unsafe-inline'`. So there are no `<script>` bodies, no `style=""`
attributes and no `onclick=""` handlers anywhere, and the build fails if one
appears. The checks live in `tools/site-checks.mjs`, which also fixes the
exact list of outside hosts each directive may name, and are tested against
pages that try to slip past them (`test/unit/site-checks.test.js`). Styles that depend on data (a bar's width, the tooltip's position)
are set through the DOM (`el.style.width = …`), which the policy allows.

**Escape everything.** Anything that reaches `innerHTML` other than a
literal in the code passes through `esc`, including values from this
repository's own data files and lookup tables. Codes that end up in URLs or queries are checked against a
pattern first (`QID`, the SPARQL country code).

**Treat storage as untrusted.** On GitHub Pages, every project site of the
same account shares one origin and so one localStorage. Everything read back
is validated: progress with `cleanRecords` (which also brings numbers into a
range real answers produce), caches through `ttlCache`'s `isValid` (with
length caps, via `shortString`; entries dated in the future are refused),
settings against the values on offer. Lookup tables are built with
`table()` so a stored `"__proto__"` cannot pass for a valid key.

**Outside requests carry nothing.** `getJSON` sends no cookies and no referrer,
refuses redirects and refuses answers over 4 MB. The REST Countries key goes only to
api.restcountries.com, and is neither read nor offered for entry when the page
is framed by another site (`FRAMED`). Erasing and importing progress are
refused when framed too, so a framing page cannot trick a learner into them.

**Keep stored names and formats.** Learners have progress on the live site.
The storage keys below, the progress key of each item and the record format
must not change; a test in `test/e2e/` checks that old records still load.

| Key                                                                             | Holds                                                                                                                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `flagatlas.progress.v1`                                                         | Flags progress, items `f:<code>`                                                                                                         |
| `flagatlasmap.progress.v1`                                                      | Countries and Territories progress, items `c:<code>`; clues `d:`/`m:<code>` (domain, currency; `p:` was the phone code, no longer asked) |
| `cityatlas.progress.v1`                                                         | Cities and Regions: `l:`/`n:`/`c:<iso>/<name>`, `r:`/`rl:<region>`                                                                       |
| `terrainatlas.progress.v1`                                                      | Terrain: `<l\|n\|c>:<kind>/<name>`                                                                                                       |
| `flagatlas.projection`                                                          | The projection, for every map                                                                                                            |
| `flagatlas.restcountries.key`, `flagatlas.restcountries.cache.v5`               | The REST Countries key and its 3-day cache                                                                                               |
| `flagatlasmap.wikidata.v1`                                                      | Countries and Territories: Wikidata cache (7 days)                                                                                       |
| `flagatlas.adoption.v1`, `flagatlas.quizLevel`                                  | Flags: adoption dates, quiz level                                                                                                        |
| `flagatlasmap.quizDir`, `flagatlasmap.quizClue`                                 | Countries and Territories: quiz direction, and the clue Clues asks                                                                       |
| `cityatlas.type`, `.cat`, `.scope`, `.hard`, `.hint`, `.len`                    | Cities and Regions drill settings                                                                                                        |
| `terrain.layers`, `terrain.level`, `.type`, `.kinds`, `.scope`, `.hard`, `.len` | Terrain layers and drill settings                                                                                                        |
| `languages.progress.v1`                                                         | Scripts and Languages: `l:`/`c:`/`m:<language>`, `t:<letter>`, `s:<script>`                                                              |
| `languages.type`, `.hard`, `.len`                                               | Scripts and Languages drill settings                                                                                                     |
| `roads.progress.v1`                                                             | Roads: `<d\|l\|s\|z\|p\|c\|w>:<code>` per clue, `x:<code>` for scenes                                                                    |
| `roads.type`, `.clues`, `.hard`, `.len`, `.where`                               | Roads drill settings                                                                                                                     |

## Tests

- `test/unit/` runs under Node (`npm run test:unit`): the shared modules, the
  drill rules against the real data, and checks that the data files decode
  and refer to each other consistently.
- `test/e2e/` runs in Chromium against the built site (`npm test`), with
  every outside host blocked. One file per app covers what a learner does;
  `smoke.spec.js` checks every page loads without errors or policy
  violations, and that injected inline script is refused.
