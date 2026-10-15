# Data generators

Python scripts that build some of the files in `src/data/` from Natural Earth.
They are run by hand when the source data changes, not as part of the build.
See [`docs/data.md`](../../docs/data.md) for the formats they write.

| Script             | Writes                                       |
| ------------------ | -------------------------------------------- |
| `build_cities.py`  | `src/data/land.json`, `src/data/cities.json` |
| `build_terrain.py` | `src/data/terrain.json`                      |

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
