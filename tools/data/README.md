# Data generators

Scripts that build some of the files in `src/data/`. They are run when the
source data changes, not as part of the build.
See [`docs/data.md`](../../docs/data.md) for the formats they write.

| Script             | Writes                                       |
| ------------------ | -------------------------------------------- |
| `build_cities.py`  | `src/data/land.json`, `src/data/cities.json` |
| `build_terrain.py` | `src/data/terrain.json`                      |
| `flag-colours.mjs` | `src/data/flag-colours.txt`                  |
| `sign-words.mjs`   | `tools/data/sign-words.json`                 |
| `languages.mjs`    | `src/data/languages.json`                    |

`flag-colours.mjs` measures each flag's main colours from its drawing on
Wikimedia Commons. It runs on GitHub through the "Flag colours" workflow
(`.github/workflows/flag-colours.yml`), and `check-flag-colours.mjs`
checks its result before the workflow commits it. See
[`docs/data.md`](../../docs/data.md#flag-colourstxt) for the format.

## The languages and the Street View countries

`languages.mjs` builds the data of the Scripts and Languages app from Unicode
CLDR, the Universal Declaration of Human Rights, and the words for "street"
and "city" that `sign-words.mjs` fetches from Wikidata. It needs no packages
installed: its header shows how to unpack the four CLDR packages and the
udhr package into a folder, and it reads them from there. It prints every
language with its script, countries, words and sentence; read the report
before committing the result.

It covers the official languages of the countries in
`street-view-countries.txt`. Google adds Street View countries now and then.
When it does:

1. Add the country's code to `street-view-countries.txt`. The list follows
   the owner's [Map Generation Tool](https://github.com/ugerhard-git/map-generation-tool)
   (`COVERAGE` in its `src/app.js`), so add it there too.
2. Open a pull request with just that change. The **Language data** workflow
   (`.github/workflows/language-data.yml`) runs on it: it unpacks CLDR and
   the UDHR translations, fetches the Wikidata words, rebuilds the data,
   checks it with `check-languages.mjs`, and commits it to the pull request.
3. Read its report on the workflow run's summary page: a new country may
   bring a new language or script, or a language CLDR has no letters for
   (reported as left out). Then review and merge as usual.

The workflow can also be run by hand (**Actions → Language data → Run
workflow**), for example to pick up corrected labels on Wikidata; it then
pushes a `language-data-<date>` branch to open a pull request from. To run
the scripts on your own machine instead, run `sign-words.mjs`, then
`languages.mjs` as its header describes.

## Road signs

`road-signs.mjs` fetches the Roads app's sign drawings: each Street View
country's stop sign, the two pedestrian crossing signs (the warning, and the
sign at the crossing itself), the chevron and the general warning sign. It
reads the country's "Road signs in …" article on Wikipedia, scores each
drawing's caption (`road-sign-wikitext.mjs`: the sign's number taken off,
bus stops, "stop ahead" and the like left out, drawings under historic or
temporary headings ignored, the warning section telling the two crossing
signs apart), and takes the best. Only drawings stored on Commons with a
reusable licence are kept.

The **Road signs** workflow (`.github/workflows/road-signs.yml`) runs it on
a pull request that changes the Street View list, the picks or the scripts,
and commits the drawings, `src/data/signs.json` and every candidate it
considered, `road-sign-candidates.json`. Review the drawings after each run.
Where a caption leads it to the wrong drawing, name the right Commons file
in `road-sign-picks.json` (or `"-"` for none) and push; the workflow runs
again:

```json
{ "JP": { "stop": "Japan_road_sign_330-A.svg" }, "US": { "crossing": "-" } }
```

A pick need not be in the article: it can be any drawing on Commons, and a
country with no article can have picks too. The app then names the drawing's
Commons page as its source instead of the article, so pick a file whose
Commons page says which country's sign it is.

The rest of this page is about the two Python scripts.

## Running them

They need Python 3.10 or later and [Shapely](https://shapely.readthedocs.io/)
2:

```sh
pip install shapely
python3 tools/data/build_cities.py path/to/natural-earth
python3 tools/data/build_terrain.py path/to/natural-earth
```

The folder holds Natural Earth's 1:10m layers, converted to GeoJSON and named
as below (for instance with `ogr2ogr -f GeoJSON out.geojson in.shp`). The
layers are not in the repository: together they are several hundred
megabytes. Download them from <https://www.naturalearthdata.com/downloads/10m-cultural-vectors/>
and <https://www.naturalearthdata.com/downloads/10m-physical-vectors/>.

| File                                                | Used by |
| --------------------------------------------------- | ------- |
| `ne_10m_admin_0_map_units.geojson`                  | both    |
| `ne_10m_admin_1_states_provinces.geojson`           | cities  |
| `ne_10m_populated_places_simple.geojson`            | cities  |
| `ne_10m_rivers_lake_centerlines.geojson`            | terrain |
| `ne_10m_lakes.geojson`                              | terrain |
| `ne_10m_geography_regions_polys.geojson`            | terrain |
| `ne_10m_geography_marine_polys.geojson`             | terrain |
| `ne_10m_geography_regions_elevation_points.geojson` | terrain |

After a run, check the result in the browser and run the tests: the unit
tests in `test/unit/data.test.js` check that the files decode and that their
codes refer to each other.

## History

These scripts produced the data in the single-file apps. When the data moved
into `src/data/`, they were changed only in where they read and write: the
input folder became an argument, and the output is written straight to the
new files. They have not been re-run since, because the Natural Earth inputs
were not to hand; the files in `src/data/` are the scripts' last output,
repackaged. A first re-run should be compared against the committed files.

The generators for `world.json` and `factbook.json` were not kept; see
`docs/data.md`.
