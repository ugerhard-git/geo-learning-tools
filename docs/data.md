# The data in `src/data/`

The apps draw on a handful of data files, served with the site and loaded when
a page opens. They are generated, not written by hand (except
`countries.txt` and `flag-tags.txt`), and are left out of Prettier: they are
long single-line strings that formatting would only make bigger.

| File               | Used by                          | What it holds                                                                                    |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `countries.txt`    | every app                        | The 253 countries and territories, their names and aliases                                       |
| `world.json`       | Flags, Countries and Territories | Country outlines in hundredths of a degree, and each country's main landmass                     |
| `factbook.json`    | Countries and Territories        | Geography sections of the CIA World Factbook, per country                                        |
| `flag-tags.txt`    | Flags                            | Each flag's colours, layout and symbols                                                          |
| `languages.json`   | Scripts and Languages            | The official languages of the Street View countries: scripts, letters, words and a sentence each |
| `roads.json`       | Roads                            | Each Street View country's driving side and centre line colour, with sources (written by hand)   |
| `signs.json`       | Roads                            | Each Street View country's sign drawings in `signs/`, with their licences, authors and sources   |
| `flag-colours.txt` | Flags                            | Each flag's main colours as hex codes, measured from its drawing                                 |
| `land.json`        | Cities and Regions, Terrain      | Simplified country outlines, and a box around each country                                       |
| `cities.json`      | Cities and Regions               | 2,738 cities, 4,596 regions and the regions' outlines                                            |
| `terrain.json`     | Terrain                          | 2,121 physical features with their geometry                                                      |
| `hero.txt`         | landing page                     | A coarse world outline for the masthead                                                          |

## Formats

### Packed coordinates

`land.json`, `cities.json`, `terrain.json` and `hero.txt` store coordinates
as integers (degrees times a scale given in each file), written 6 bits per
character. Each ring is delta-encoded: the first pair is absolute, every
later pair the change from the one before. Signs are zig-zag encoded (0, -1,
1, -2 … become 0, 1, 2, 3 …), and a character's sixth bit says the number
continues in the next character. The alphabet `A–Z a–z 0–9 + -` is safe in
JSON strings, so tabs and newlines stay free as separators. The decoder is
`unpack` in `src/shared/codec.js`; the encoder is `pack` in the generators.

### `countries.txt`

One place per line, fields separated by `|`:

```
code | alpha-3 | name | region | status | wiki | aliases
NL   | NLD     | Netherlands | E | u | the Netherlands | Holland
```

Region is one of `F A S E O N` (Africa, Americas, Asia, Europe, Oceania,
Antarctica). Status is `u` UN member, `o` observer state, `p` partially
recognised, `t` territory, `c` constituent country. `wiki` is how English
Wikipedia names the place in "Flag of …", or after `=` the whole title of the
flag article; aliases are other names accepted as answers. See
`src/shared/countries.js`.

### `world.json`

```json
{ "f": [{ "r": "x,y,dx,dy,…|…", "c": ["FR"] }, …],
  "i": { "FR": { "b": [west, south, east, north], "m": [lon, lat] }, … } }
```

`f` lists 298 outlines: rings of comma-separated integers in hundredths of a
degree, delta-encoded, separated by `|`, with the codes of the countries each
outline belongs to. `i` gives each country's main landmass as a box and a
point near its middle. The outline coded `XD` belongs to no country in the
table and is drawn greyed out.

### `land.json`

```json
{ "scale": { "shape": 40, "box": 50 }, "shapes": "…", "boxes": "…" }
```

`shapes`: one outline per line, `codes <TAB> ring|ring|…`. `boxes`: one
country per line, `code <TAB> packed`, six numbers: west, south, east, north,
and a point near the middle of the largest piece.

### `cities.json`

```json
{ "scale": { "region": 40, "city": 1000 }, "regions": "…", "regionShapes": "…", "cities": "…" }
```

- `cities`: `name <TAB> other names (;) <TAB> country <TAB> region <TAB>
packed lon,lat <TAB> packed population in thousands <TAB> type`, where type
  is 2 for a national capital, 1 for a regional capital and 0 otherwise.
- `regions`: `code <TAB> name <TAB> other name <TAB> country`. A few regions
  belong to `UM` (US Minor Outlying Islands) or `-1` (Natural Earth's code for
  disputed areas), which are not in the country table.
- `regionShapes`: `code <TAB> ring|ring|…`.

### `terrain.json`

```json
{ "scale": { "line": 40, "point": 1000 }, "features": "…" }
```

One feature per line: `kind <TAB> name <TAB> other names (;) <TAB> continent
<TAB> countries ( · ) <TAB> Wikidata id <TAB> extra <TAB> scalerank <TAB>
geometry <TAB> parts (|)`. Kinds are listed in `src/terrain/data.js`.
The continent is a region letter, or `W` for the open ocean. `extra` is a
peak's height in metres. Geometry is `p` (area), `l` (line) or `x` (point);
points use `scale.point`, the rest `scale.line`. Scalerank is Natural Earth's
measure of how prominent a feature is, which the drills use as "how well
known".

### `flag-tags.txt`

One flag per line: `code colours layout symbols`, e.g. `DE kry h -`. The
letters are explained in `src/flags/design.js`.

### `flag-colours.txt`

One flag per line, tab-separated: `code`, the Commons file it was measured
from, and its main colours as `#RRGGBB` codes separated by spaces, largest
area first, e.g. `DE  Flag_of_Germany.svg  #000000 #DD0000 #FFCE00`. Lines
starting with `#` are comments. "Main" means covering at least 2% of the flag,
so the fine detail of a coat of arms is left out. Places that fly another
country's flag have no line: the French territories show France's colours.
The Cocos Islands have none either: Wikipedia's drawing for them is
Australia's flag, not the green flag the app shows.

### `factbook.json`

`{ "FR": [{ "l": "section title or empty", "r": [["Label", "Text"], …] }, …] }`:
the geography sections of the CIA World Factbook entry for each country that
has one.

### `languages.json`

```json
{ "cldr": "48.2.0", "udhr": "6.0.0",
  "scripts": { "Latn": "Latin", "Thai": "Thai", … },
  "languages": [{ "id": "pl", "name": "Polish", "autonym": "polski", "script": "Latn",
                  "countries": ["PL"], "letters": "aąbcć…", "words": ["poniedziałek", …],
                  "sentence": "Wszyscy ludzie rodzą się wolni …" }, …],
  "telltales": [{ "letter": "ł", "languages": ["pl"] }, …] }
```

- **Which languages:** those official, or official in practice, in a country
  listed in `tools/data/street-view-countries.txt`, according to CLDR, less a
  few left out on purpose (listed in `tools/data/languages.mjs`).
- **`id`** is the CLDR locale; a language written in two scripts on signs has
  one entry per script (`sr`, `sr-Latn`). **`script`** is an ISO 15924 code.
- **`letters`** are CLDR's main exemplar letters, in lower case.
- **`words`** are real words: weekday and month names, the language's name
  for itself and its names for its countries. Words two languages share are
  dropped, since they cannot tell them apart.
- **`sentence`** is the first sentence of Article 1 of the Universal
  Declaration of Human Rights.
- **`street`** and **`city`** are the language's words for them, as seen on
  street and town signs: the Wikidata labels of "street" (Q79007) and "city"
  (Q515), kept in `tools/data/sign-words.json`. Missing where Wikidata has no
  label in that language.
- **`telltales`** are letters of the Latin and Cyrillic alphabets that four
  languages or fewer use, at most six per language, the rarest first.

### `roads.json`

```json
{ "sources": { "traffic": { "title": "Left- and right-hand traffic", "url": "https://…", "publisher": "Wikipedia" }, … },
  "countries": { "JP": { "drive": "left", "driveSource": "traffic",
                         "centre": { "colour": "both", "note": "…", "source": "markings" } }, … } }
```

Written by hand, one entry per Street View country. **`colour`** is
`white`, `yellow` or `both`; **`regional: true`** marks a country covered
only by its part of the world's rule ("most European countries use white"),
which the app shows in italics. A country with no solid source for its lines
has no `centre`, and the app says so rather than guess.

Where a source describes the lines' style, **`patterns`** lists them, the
usual one first, each with what it means:
`{ "lines": ["solid-yellow", "dashed-white"], "meaning": "…" }`, the lines
left to right, each `solid`, `dashed`, `long-dash` or `short-dash`, then
`white` or `yellow` (up to three lines, as in the Philippines' double yellow
either side of a broken white line). **`patternSource`** names the source.
A style of `line` means the source gives the colour but not whether the
line is solid or broken; the app names it by its colour ("double yellow")
and draws it solid. A pattern may name its own **`source`** when it comes
from a different one than the rest.

The app draws the first pattern in its road scenes and lists all of them in
a country's details; without patterns it draws the colour alone and says the
style is not sourced.

**`edge`** describes the edge lines the same way:
`{ "colour": "yellow", "style": "line", "note": "…", "source": "…" }`, with
`colour` `white`, `yellow` or `none` (no edge lines) and `style` as above.
Without it the drawings show plain white edges.

The sources are Wikipedia's articles and, for many countries, the
country's [Plonk It](https://www.plonkit.net/) guide. Facts are taken from
them and written afresh; nothing is copied.

### `signs.json` and `signs/`

```json
{ "JP": { "stop": { "file": "jp-stop.svg", "commons": "Japan_road_sign_330-A.svg",
                    "licence": "Public domain", "author": "…", "source": "Road signs in Japan" }, … } }
```

Per country, up to five drawings: `stop`, `crossing` (the sign at a
pedestrian crossing), `pedestrian` (the warning that one is coming),
`chevron` and `warning` (the general warning sign). Each is a copy of a file
on Wikimedia Commons, kept only if its licence allows reuse (public domain,
CC0, CC BY, CC BY-SA), with its author for the credit.

## Where it comes from

| Data                                                                        | Source                                                                                                      | Licence                                                         |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Country, region, city and feature geometry; city populations; feature ranks | [Natural Earth](https://www.naturalearthdata.com/) 1:10m (cultural and physical vectors)                    | Public domain                                                   |
| Geography sections                                                          | [CIA World Factbook](https://github.com/factbook/factbook.json), final edition (discontinued February 2026) | Public domain                                                   |
| Wikidata ids of features                                                    | Carried in Natural Earth's own attributes                                                                   | Public domain                                                   |
| Flag colour codes                                                           | Measured from the flag drawings on [Wikimedia Commons](https://commons.wikimedia.org/)                      | Public domain                                                   |
| Languages: official status, scripts, letters, words, names                  | [Unicode CLDR](https://cldr.unicode.org/) 48.2                                                              | Unicode License v3 ([text](../licenses/unicode-license-v3.txt)) |
| Words for "street" and "city"                                               | [Wikidata](https://www.wikidata.org/) labels of Q79007 and Q515                                             | CC0                                                             |
| Sample sentences                                                            | [UDHR in Unicode](https://www.unicode.org/udhr/), via the [udhr](https://github.com/wooorm/udhr) package    | Translations by the UN OHCHR; package MIT                       |
| Driving side, road line colours and styles                                  | Wikipedia, World Standards and the Plonk It guides, per country in `roads.json`                             | Facts; the sources are linked in the app                        |
| Road sign drawings                                                          | [Wikimedia Commons](https://commons.wikimedia.org/), as shown in Wikipedia's "Road signs in …" articles     | Each file's own: public domain, CC0, CC BY or CC BY-SA          |
| Country table, flag tags, look-alike groups                                 | Written for this project                                                                                    | MIT                                                             |

### How each file was made

- **`land.json` and `cities.json`**: `tools/data/build_cities.py`, from Natural
  Earth's admin-0 map units, admin-1 states and provinces, and populated
  places. It also corrects a few capitals Natural Earth has wrong or out of
  date. See [`tools/data/README.md`](../tools/data/README.md).
- **`terrain.json`**: `tools/data/build_terrain.py`, from Natural Earth's
  rivers, lakes, geography regions (polygons and elevation points) and marine
  areas, with the admin-0 map units for the countries each feature touches.
- **`flag-colours.txt`**: `tools/data/flag-colours.mjs`, run on GitHub by
  the "Flag colours" workflow, since Commons cannot be reached from every
  machine. It finds each flag's drawing as the lead image of its Wikipedia
  flag article, draws it in Chromium and counts the pixels of each colour.
  To refresh it, for example after a country changes its flag, run the
  workflow by hand (**Actions → Flag colours → Run workflow**); it pushes a
  `flag-colours-<date>` branch to open a pull request from.
- **`languages.json`**: `tools/data/languages.mjs`, from the CLDR and udhr
  npm packages, unpacked into a folder (see the script's header), and the
  Wikidata labels in `tools/data/sign-words.json` (made by
  `tools/data/sign-words.mjs`). The list of Street View countries it starts
  from is `tools/data/street-view-countries.txt`. The "Language data"
  workflow rebuilds both files on GitHub and commits them; see
  [`tools/data/README.md`](../tools/data/README.md).
- **`signs.json`** and **`signs/`**: `tools/data/road-signs.mjs`, run on
  GitHub by the "Road signs" workflow. It reads each country's "Road signs
  in …" article, picks drawings by caption and by the heading they sit under,
  and fetches them from Commons with their licences. A wrong pick is fixed in
  `tools/data/road-sign-picks.json`; see
  [`tools/data/README.md`](../tools/data/README.md).
- **`roads.json`**: written by hand from the sources it names.
- **`world.json`** and **`factbook.json`**: made with earlier scripts that
  were not kept, so they cannot be rebuilt as they stand. `world.json` is
  Natural Earth country outlines in longitude/latitude, rounded to 0.01° (the
  scale of the source layer was not recorded); `factbook.json` is the geography part of the factbook.json project's
  final export, cleaned of markup. Rebuilding either means writing a new
  generator; the formats above are what it has to produce.
- **`hero.txt`**: a coarse outline of the same land, packed at 12 units per
  degree.

The data files were carried over unchanged from the single-file apps; the
split into files changed the containers (`land.json` is shared by Cities and
Terrain, which had identical copies), not the contents.
