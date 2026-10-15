"""Build src/data/terrain.json, the physical features of Terrain Atlas, from
Natural Earth. See tools/data/README.md for the inputs and how to run it:

    python3 tools/data/build_terrain.py path/to/natural-earth

Coordinates are written packed, 6 bits per character (see pack() below and
unpack() in src/shared/codec.js, which must stay in step with it).
"""
import json, math, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path
from shapely.geometry import shape, MultiPolygon, MultiLineString, Point
from shapely.strtree import STRtree

NE = Path(sys.argv[1] if len(sys.argv) > 1 else "natural-earth")
OUT = Path(__file__).resolve().parents[2] / "src" / "data"

ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-"
def pack(nums):
    out = []
    for v in nums:
        u = (-v << 1) - 1 if v < 0 else v << 1
        while u >= 32:
            out.append(ALPHA[(u & 31) | 32]); u >>= 5
        out.append(ALPHA[u])
    return ''.join(out)

Q = 40                      # 0.025 degrees, the same grid the other apps use
def enc(coords, close):
    pts = [(round(x*Q), round(y*Q)) for x, y in coords]
    out = []; prev = None
    for p in pts:
        if p != prev: out.append(p); prev = p
    if close and len(out) > 1 and out[0] == out[-1]: out.pop()
    if len(out) < (3 if close else 2): return None
    n = [out[0][0], out[0][1]]
    for a, b in zip(out, out[1:]): n += [b[0]-a[0], b[1]-a[1]]
    return pack(n)

def simplify_parts(geom, base, mult, maxtol, minarea):
    """Return encoded parts plus the shapely pieces they came from."""
    g = shape(geom)
    if g.geom_type in ('Polygon', 'MultiPolygon'):
        parts = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
        out = []
        for pg in parts:
            tol = max(base, min(maxtol, math.sqrt(pg.area)*mult))
            if pg.area < tol*tol*minarea: continue
            sp = pg.simplify(tol, preserve_topology=True)
            if sp.is_empty: continue
            e = enc(sp.exterior.coords, True)
            if e: out.append(e)
        if not out:
            big = max(parts, key=lambda q: q.area); c = big.representative_point(); d = 0.06
            e = enc([(c.x-d,c.y-d),(c.x+d,c.y-d),(c.x+d,c.y+d),(c.x-d,c.y+d)], True)
            if e: out.append(e)
        return out, 'p', g
    parts = list(g.geoms) if isinstance(g, MultiLineString) else [g]
    out = []
    for ln in parts:
        tol = max(base, min(maxtol, ln.length*mult*0.25))
        sp = ln.simplify(tol, preserve_topology=False)
        if sp.is_empty: continue
        e = enc(sp.coords, False)
        if e: out.append(e)
    return out, 'l', g

def akey(s):
    return unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower().strip()
def clean(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()

# A few sources give an all-caps NAME, or an English name that drops the generic word
# ("Great Bear" for Great Bear Lake, "Nyanza" for Lake Victoria). Prefer the fullest
# properly-cased form and keep the rest as alternates.
def best_name(*cands):
    vals = [clean(c) for c in cands if clean(c)]
    seen, uniq = set(), []
    for v in vals:
        if akey(v) and akey(v) not in seen: seen.add(akey(v)); uniq.append(v)
    if not uniq: return '', ''
    uniq.sort(key=lambda v: (v.isupper(), -len(v)))
    return uniq[0], '; '.join(uniq[1:])[:90]

RENAME = {('riv','rhein'):'Rhine', ('riv','donau'):'Danube', ('riv','maas'):'Meuse'}

def rank(p, *keys):
    """Scalerank 0 means 'most important', so a plain `or` default would discard it."""
    for k in keys:
        v = p.get(k)
        if v is not None: return v
    return 99

def tidy_alt(a):
    return '; '.join((x.strip().title() if x.strip().isupper() else x.strip())
                     for x in str(a or '').split(';') if x.strip())

# ---- countries, for "which countries it touches" and for the continent ----
cd = json.load(open(NE / 'ne_10m_admin_0_map_units.geojson'))
cgeom, cname, ccont = [], [], []
CONT = {'Africa':'F','North America':'A','South America':'A','Asia':'S','Europe':'E','Oceania':'O','Antarctica':'N','Seven seas (open ocean)':'W'}
for ft in cd['features']:
    p = ft['properties']
    # NAME_LONG/NAME are the everyday forms; NAME_EN gives "People's Republic of China"
    nm = p.get('NAME') or p.get('NAME_LONG') or p.get('NAME_EN')
    if not nm: continue
    cgeom.append(shape(ft['geometry'])); cname.append(nm)
    ccont.append(CONT.get(p.get('CONTINENT'), ''))
ctree = STRtree(cgeom)

def touches(g, limit=6):
    """Countries the feature overlaps, and the continent it mostly sits in."""
    names, conts = [], defaultdict(float)
    try:
        cand = ctree.query(g)
    except Exception:
        cand = []
    for j in cand:
        try:
            if not cgeom[j].intersects(g): continue
            inter = cgeom[j].intersection(g)
            amount = inter.area if g.geom_type in ('Polygon','MultiPolygon') else inter.length
        except Exception:
            continue
        if amount <= 0: continue
        names.append((amount, cname[j]))
        if ccont[j]: conts[ccont[j]] += amount
    names.sort(reverse=True)
    cont = max(conts, key=conts.get) if conts else ''
    return [n for _, n in names[:limit]], cont

def nearest_countries(g, limit=3):
    """A summit sitting exactly on a border intersects nothing, so fall back to distance."""
    out = []
    for j in ctree.query(g.buffer(0.6)):
        d = cgeom[j].distance(g)
        if d <= 0.35: out.append((d, cname[j]))
    out.sort()
    return [n for _, n in out[:limit]]

def fallback_continent(g):
    c = g.representative_point() if g.geom_type != 'Point' else g
    best, bd = '', 1e9
    for j in ctree.query(c.buffer(12)):
        d = cgeom[j].distance(c)
        if d < bd: bd, best = d, ccont[j]
    return best

# ---- the categories the app offers ----
# kind code | label | source | filter | simplification
items = []
def add(kind, name, alt, cont, countries, qid, extra, gtype, parts, geom, sr=9):
    if not parts or not name: return
    items.append(dict(kind=kind, name=name, alt=alt, cont=cont, countries=countries, sr=int(sr),
                      qid=qid or '', extra=extra or '', gt=gtype, parts=parts, bounds=geom.bounds))

def load(f): return json.load(open(NE / ('%s.geojson' % f)))['features']

# rivers: the named ones people actually learn
for ft in load('ne_10m_rivers_lake_centerlines'):
    p = ft['properties']
    if (p.get('featurecla') or '') != 'River': continue
    nm, alt = best_name(p.get('name_en'), p.get('name'), p.get('name_alt'))
    nm = RENAME.get(('riv', akey(nm)), nm)
    if not nm or rank(p, 'scalerank') > 7: continue
    parts, gt, g = simplify_parts(ft['geometry'], 0.05, 0.02, 0.5, 0)
    cs, cont = touches(g)
    add('riv', nm, alt, cont or fallback_continent(g), cs, p.get('wikidataid'), '', gt, parts, g, rank(p,'scalerank'))

# lakes
for ft in load('ne_10m_lakes'):
    p = ft['properties']
    nm, alt = best_name(p.get('name'), p.get('name_en'), p.get('name_alt'))
    if not nm or rank(p, 'scalerank') > 6: continue
    parts, gt, g = simplify_parts(ft['geometry'], 0.02, 0.02, 0.2, 2)
    cs, cont = touches(g)
    add('lak', nm, alt, cont or fallback_continent(g), cs, p.get('wikidataid'), '', gt, parts, g, rank(p,'scalerank'))

# land regions: ranges, deserts, plateaus, plains, islands, peninsulas
KIND = {'Range/mtn':'rng', 'Desert':'des', 'Plateau':'plt', 'Plain':'plt', 'Basin':'plt',
        'Lowland':'plt', 'Delta':'plt', 'Island':'isl', 'Island group':'isl',
        'Peninsula':'pen', 'Pen/cape':'pen', 'Geoarea':'reg'}
for ft in load('ne_10m_geography_regions_polys'):
    p = ft['properties']
    kind = KIND.get(p.get('FEATURECLA'))
    if not kind: continue
    nm, alt = best_name(p.get('NAME_EN'), p.get('NAME'), p.get('NAMEALT'))
    if not nm or rank(p, 'SCALERANK') > 4: continue
    parts, gt, g = simplify_parts(ft['geometry'], 0.03, 0.02, 0.35, 2)
    cs, cont = touches(g)
    reg = {'Africa':'F','North America':'A','South America':'A','Asia':'S','Europe':'E','Oceania':'O','Antarctica':'N'}.get(p.get('REGION'), '')
    add(kind, nm, alt, reg or cont or fallback_continent(g), cs, p.get('WIKIDATAID'), '', gt, parts, g, rank(p,'SCALERANK'))

# seas, gulfs, bays, straits
MARINE = {'ocean':'sea', 'sea':'sea', 'gulf':'gul', 'bay':'gul', 'strait':'str',
          'channel':'str', 'sound':'str', 'lagoon':'gul'}
for ft in load('ne_10m_geography_marine_polys'):
    p = ft['properties']
    kind = MARINE.get(p.get('featurecla'))
    if not kind: continue
    nm, alt = best_name(p.get('name_en'), p.get('name'), p.get('name_alt'))
    if not nm or rank(p, 'scalerank') > 7: continue
    parts, gt, g = simplify_parts(ft['geometry'], 0.05, 0.02, 0.5, 2)
    cs, cont = touches(g)
    add(kind, nm, alt, cont or fallback_continent(g), cs, p.get('wikidataid'), '', gt, parts, g, rank(p,'scalerank'))

# peaks
for ft in load('ne_10m_geography_regions_elevation_points'):
    p = ft['properties']
    if (p.get('featurecla') or '') != 'mountain': continue
    nm, alt = best_name(p.get('name_en'), p.get('name'), p.get('name_alt'))
    el = p.get('elevation') or 0
    if not nm or el < 1500: continue
    x, y = ft['geometry']['coordinates'][:2]
    g = Point(x, y)
    cs, cont = touches(g)
    if not cs: cs = nearest_countries(g)
    reg = {'Africa':'F','North America':'A','South America':'A','Asia':'S','Europe':'E','Oceania':'O','Antarctica':'N'}.get(p.get('region'), '')
    # peaks carry no scalerank, so height stands in for how well known a summit is
    sr = 0 if el >= 6000 else 1 if el >= 4500 else 2 if el >= 3500 else 4 if el >= 2500 else 6
    add('pea', nm, alt, reg or cont or fallback_continent(g), cs,
        p.get('wikidataid'), str(int(el)), 'x', [pack([round(x*1000), round(y*1000)])], g, sr)

# ---- merge duplicates ----
# Rivers arrive in segments and many share a name. Same-name parts that sit near each other
# are one feature; distant namesakes are separate places, so only the largest is kept.
def near(a, b):
    return not (a[0] > b[2] + 20 or b[0] > a[2] + 20 or a[1] > b[3] + 20 or b[1] > a[3] + 20)
groups = defaultdict(list)
for it in items: groups[(it['kind'], akey(it['name']))].append(it)
merged = []
for (kind, _), gs in groups.items():
    if len(gs) == 1: merged.append(gs[0]); continue
    if kind == 'pea':                       # distinct summits that share a name
        merged.append(max(gs, key=lambda x: int(x['extra'] or 0))); continue
    base = max(gs, key=lambda x: len(''.join(x['parts'])))
    base['sr'] = min(x['sr'] for x in gs)
    for o in gs:
        if o is base: continue
        if o['gt'] == base['gt'] and near(o['bounds'], base['bounds']):
            base['parts'] += o['parts']
            for c in o['countries']:
                if c not in base['countries']: base['countries'].append(c)
    merged.append(base)
merged.sort(key=lambda x: (x['kind'], akey(x['name'])))
rows = ['\t'.join([m['kind'], m['name'], tidy_alt(m['alt']), m['cont'], ' · '.join(m['countries'][:6]),
                   m['qid'], m['extra'], str(m['sr']), m['gt'], '|'.join(m['parts'])]) for m in merged]
BLOCK = '\n'.join(rows)
with open(OUT / 'terrain.json', 'w') as f:
    json.dump({'scale': {'line': Q, 'point': 1000}, 'features': BLOCK}, f,
              ensure_ascii=False, separators=(',', ':'))
    f.write('\n')

from collections import Counter
print('features:', len(rows))
print(Counter(r.split('\t')[0] for r in rows).most_common())
print('continents:', Counter(r.split('\t')[3] for r in rows).most_common())
print('bytes:', len(json.dumps(BLOCK, ensure_ascii=False).encode()))
print('with a Wikidata id:', sum(1 for r in rows if r.split('\t')[5]))
print('with countries:', sum(1 for r in rows if r.split('\t')[4]))
print('by rank:', sorted(Counter(int(r.split('\t')[7]) for r in rows).items()))
print('rank<=2 per kind:', Counter(r.split('\t')[0] for r in rows if int(r.split('\t')[7])<=2).most_common())
print('rank<=4 total:', sum(1 for r in rows if int(r.split('\t')[7])<=4))
