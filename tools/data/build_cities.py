"""Build src/data/land.json and src/data/cities.json from Natural Earth.

Country outlines (shared by City Atlas and Terrain Atlas), region outlines,
and the cities. See tools/data/README.md for the inputs and how to run it:

    python3 tools/data/build_cities.py path/to/natural-earth

Coordinates are written packed, 6 bits per character (see pack() below and
unpack() in src/shared/codec.js, which must stay in step with it).
"""
import json, math, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path
from shapely.geometry import shape, MultiPolygon, Point
from shapely.strtree import STRtree

NE = Path(sys.argv[1] if len(sys.argv) > 1 else "natural-earth")
OUT = Path(__file__).resolve().parents[2] / "src" / "data"

# 6 bits per character: 5 data bits + 1 continuation bit, zig-zag signed.
# The alphabet avoids " \ ` and all whitespace, so the result is safe inside
# JSON strings and JS template literals, and \t / \n stay usable as separators.
ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-"
assert len(ALPHA) == 64 and len(set(ALPHA)) == 64

def pack(nums):
    out = []
    for v in nums:
        u = (-v << 1) - 1 if v < 0 else v << 1
        while u >= 32:
            out.append(ALPHA[(u & 31) | 32]); u >>= 5
        out.append(ALPHA[u])
    return ''.join(out)

def enc_ring(coords, Q):
    pts = [(round(x*Q), round(y*Q)) for x, y in coords]
    out = []; prev = None
    for p in pts:
        if p != prev: out.append(p); prev = p
    if len(out) > 1 and out[0] == out[-1]: out.pop()
    if len(set(out)) < 3: return None
    n = [out[0][0], out[0][1]]
    for a, b in zip(out, out[1:]): n += [b[0]-a[0], b[1]-a[1]]
    return pack(n)

def rings_of(geom, Q, base, mult, minarea, maxtol):
    g = shape(geom)
    geoms = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
    out = []
    for pg in geoms:
        tol = max(base, min(maxtol, math.sqrt(pg.area)*mult))
        if pg.area < tol*tol*minarea: continue
        sp = pg.simplify(tol, preserve_topology=True)
        if sp.is_empty: continue
        e = enc_ring(sp.exterior.coords, Q)
        if e: out.append(e)
    if not out:
        big = max(geoms, key=lambda q: q.area)
        c = big.representative_point(); d = 0.06
        e = enc_ring([(c.x-d, c.y-d), (c.x+d, c.y-d), (c.x+d, c.y+d), (c.x-d, c.y+d)], Q)
        if e: out.append(e)
    return out, geoms

def bbox_of(geoms, near, pad):
    big = max(geoms, key=lambda q: q.area)
    x0, y0, x1, y1 = big.bounds
    D = max(x1-x0, y1-y0)*near + pad
    for q in geoms:
        a, b, c, d = q.bounds
        if a > x0-D and c < x1+D and b > y0-D and d < y1+D:
            x0, y0, x1, y1 = min(x0, a), min(y0, b), max(x1, c), max(y1, d)
    rp = big.representative_point()
    return (x0, y0, x1, y1), (rp.x, rp.y)

BQ = 50           # bounding boxes and marker points, at 0.02 degrees
CQ_COUNTRY = 40   # country outline coordinates, at 0.025 degrees
CQ_REGION = 40    # region outline coordinates, at 0.025 degrees
def box_str(b, m):
    return pack([round(b[0]*BQ), round(b[1]*BQ), round((b[2]-b[0])*BQ), round((b[3]-b[1])*BQ),
                 round(m[0]*BQ), round(m[1]*BQ)])

# ---------------- country outlines ----------------
SUB = {'England':'GB-ENG','Scotland':'GB-SCT','Wales':'GB-WLS','N. Ireland':'GB-NIR'}
d = json.load(open(NE / 'ne_10m_admin_0_map_units.geojson'))
shape_lines, polys = [], defaultdict(list)
for ft in d['features']:
    p = ft['properties']
    c = p.get('ISO_A2_EH') if p.get('ISO_A2_EH') not in (None, '-99') else p.get('ISO_A2')
    codes = [] if c == '-99' else [c]
    if p['NAME'] in SUB: codes.append(SUB[p['NAME']])
    rings, geoms = rings_of(ft['geometry'], CQ_COUNTRY, 0.012, 0.018, 4, 0.09)
    shape_lines.append('%s\t%s' % (','.join(codes), '|'.join(rings)))
    for cc in codes: polys[cc] += geoms
box_lines = []
for cc, gl in sorted(polys.items()):
    b, m = bbox_of(gl, 0.35, 0.36)
    box_lines.append('%s\t%s' % (cc, box_str(b, m)))
COUNTRY_SHAPES = '\n'.join(shape_lines)
COUNTRY_BOXES = '\n'.join(box_lines)

# ---------------- region outlines (admin-1) ----------------
d1 = json.load(open(NE / 'ne_10m_admin_1_states_provinces.geojson'))
rshape, rmeta, seen, taken = [], [], defaultdict(int), set()
rlookup = {}
rgeoms, rcodes = [], []
def akey(s):
    return unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower().strip()
for ft in d1['features']:
    p = ft['properties']
    iso2 = p.get('iso_a2')
    if not iso2 or iso2 == '-99': iso2 = (p.get('adm0_a3') or '??')[:2]
    code = p.get('iso_3166_2')
    if not code or not re.match(r'^[A-Za-z0-9-]{2,10}$', str(code)) or code in taken:
        seen[iso2] += 1; code = '%s~%d' % (iso2, seen[iso2])
    taken.add(code)
    rings, geoms = rings_of(ft['geometry'], CQ_REGION, 0.014, 0.026, 8, 0.15)
    name = (p.get('name') or code).strip()
    alt = (p.get('name_alt') or '').strip()
    if akey(alt) == akey(name): alt = ''
    rshape.append('%s\t%s' % (code, '|'.join(rings)))
    # no bounding box here: the app derives it from the rings when it needs one
    rmeta.append('%s\t%s\t%s\t%s' % (code, name, alt, iso2))
    # primary names win over alternates, which collide across regions
    if name: rlookup.setdefault((iso2, akey(name)), code)
    if alt: rlookup.setdefault((iso2, akey(alt), 'alt'), code)
    rgeoms.append(shape(ft['geometry'])); rcodes.append(code)
REGION_SHAPES = '\n'.join(rshape)
REGION_META = '\n'.join(rmeta)
rtree = STRtree(rgeoms)

# ---------------- cities ----------------
# Natural Earth's capital flags carry a few errors and some stale names. These are
# corrections to well-established facts, applied so the drills never teach the wrong answer.
CAP_ADD  = {('TZ','Dodoma'), ('BI','Gitega'), ('BJ','Porto-Novo'),
            ('LK','Sri Jayawardenepura Kotte'), ('XK','Pristina')}
CAP_DROP = {('TZ','Dar es Salaam'), ('BI','Bujumbura')}
RENAME   = {('KZ','Nur-Sultan'): ('Astana', ['Nur-Sultan']),      # renamed back in 2022
            ('PW','Melekeok'):   ('Ngerulmud', ['Melekeok'])}     # seat of government since 2006
ISO_FIX  = {'Pristina':'XK'}
dc = json.load(open(NE / 'ne_10m_populated_places_simple.geojson'))
CQ = 1000  # city coordinates at 0.001 degrees, about 100 m
rows, unmatched = [], 0
for ft in dc['features']:
    p = ft['properties']
    fc = p.get('featurecla') or ''
    if fc in ('Scientific station', 'Meteorological Station', 'Historic place'): continue
    name = re.sub(r'\s+', ' ', (p.get('name') or '')).strip()
    iso2 = ISO_FIX.get(name) or p.get('iso_a2')
    if not iso2 or iso2 == '-99' or not name: continue
    extra_alts = []
    if (iso2, name) in RENAME: name, extra_alts = RENAME[(iso2, name)]
    # adm0cap is the reliable flag; the featurecla text also covers former and alternate capitals
    cap0 = (p.get('adm0cap') == 1 or (iso2, name) in CAP_ADD) and (iso2, name) not in CAP_DROP
    cap1 = fc.startswith('Admin-1')
    pop = p.get('pop_max') or 0
    if not (cap0 or cap1 or pop >= 1000000): continue
    alts = list(extra_alts)
    for f in ('nameascii', 'namealt', 'namepar'):
        v = p.get(f)
        if not v: continue
        for part in re.split(r'[|/]', str(v)):
            part = part.strip()
            if part and akey(part) != akey(name) and part not in alts: alts.append(part)
    # Which polygon contains the city is unambiguous; the layer's own region
    # names are mojibake in places and collide across regions elsewhere.
    pt = Point(p['longitude'], p['latitude'])
    inside = [j for j in rtree.query(pt) if rgeoms[j].contains(pt)]
    if inside:
        rcode = rcodes[inside[0]]
    else:
        a1 = akey(p.get('adm1name') or '')
        rcode = rlookup.get((iso2, a1)) or rlookup.get((iso2, a1, 'alt')) or ''
        if not rcode:
            near = [(rgeoms[j].distance(pt), j) for j in rtree.query(pt.buffer(0.5))]
            if near: rcode = rcodes[min(near)[1]]
    if cap1 and not rcode: unmatched += 1
    rows.append('\t'.join([name, ';'.join(alts)[:110], iso2, rcode,
        pack([round(p['longitude']*CQ), round(p['latitude']*CQ)]),
        pack([max(1, round(pop/1000))]), '2' if cap0 else ('1' if cap1 else '0')]))
CITIES = '\n'.join(rows)
print('cities', len(rows), '| national', sum(1 for r in rows if r.endswith('\t2')),
      'regional', sum(1 for r in rows if r.endswith('\t1')), 'big', sum(1 for r in rows if r.endswith('\t0')),
      '| regional capitals with no region shape', unmatched)

# The apps read the scales from the files rather than repeating the numbers,
# so encoder and decoder cannot drift apart.
def write(name, data):
    with open(OUT / name, 'w') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')

write('land.json', {'scale': {'shape': CQ_COUNTRY, 'box': BQ},
                    'shapes': COUNTRY_SHAPES, 'boxes': COUNTRY_BOXES})
write('cities.json', {'scale': {'region': CQ_REGION, 'city': CQ},
                      'regions': REGION_META, 'regionShapes': REGION_SHAPES, 'cities': CITIES})
blocks = {'COUNTRY_SHAPES': COUNTRY_SHAPES, 'COUNTRY_BOXES': COUNTRY_BOXES,
          'REGION_SHAPES': REGION_SHAPES, 'REGION_META': REGION_META, 'CITIES': CITIES}
tot = 0
for k, v in blocks.items():
    if not isinstance(v, str): continue
    n = len(json.dumps(v, ensure_ascii=False).encode()); tot += n
    print('%-15s %8d' % (k, n))
print('%-15s %8d' % ('TOTAL', tot))
