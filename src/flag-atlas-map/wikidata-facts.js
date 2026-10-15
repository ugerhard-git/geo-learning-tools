/**
 * A country's politics, people and symbols from Wikidata, for the detail
 * panel of Flag Atlas Map: one SPARQL query per country, cached for a week.
 *
 * @module flag-atlas-map/wikidata-facts
 */
import { fmtNum, table } from "../shared/dom.js";
import { str } from "../shared/net.js";
import { shortString, ttlCache } from "../shared/storage.js";
import { QID, sparql } from "../shared/wikidata.js";

/**
 * The properties shown, by section. A third element says how several values
 * are shown: "latest" keeps the most recent one, "share" sorts by share and
 * prints the percentage; otherwise they are listed.
 */
const PROPS = table({
  P36: ["basic", "Capital"],
  P1082: ["basic", "Population", "latest"],
  P37: ["basic", "Official languages"],
  P38: ["basic", "Currency"],
  P122: ["politics", "Form of government"],
  P35: ["politics", "Head of state"],
  P6: ["politics", "Head of government"],
  P194: ["politics", "Legislature"],
  P172: ["people", "Ethnic groups", "share"],
  P140: ["people", "Religions", "share"],
  P3075: ["people", "Official religion"],
  P2250: ["people", "Life expectancy", "latest"],
  P1081: ["people", "Human Development Index", "latest"],
  P85: ["more", "Anthem"],
  P1451: ["more", "Motto"],
  P30: ["more", "Continent"],
  P610: ["more", "Highest point"],
  P421: ["more", "Time zones"],
  P1622: ["more", "Drives on the"],
  P474: ["more", "Calling code"],
});

const SECTIONS = ["basic", "politics", "people", "more"];

/**
 * @typedef {object} CountryWikidata
 * @property {string | null} qid
 * @property {[string, string][]} basic
 * @property {[string, string][]} politics
 * @property {[string, string][]} people
 * @property {[string, string][]} more
 */

/**
 * The SPARQL query for one country. The code is put into the query, so it
 * must have exactly the shape of an ISO code: "DE", or "GB-SCT".
 * @param {string} code
 */
export function factsQuery(code) {
  if (!/^[A-Z]{2}(-[A-Z]{3})?$/.test(code)) throw new Error("Not a country code");
  const which = code.includes("-") ? `?c wdt:P300 "${code}" .` : `?c wdt:P297 "${code}" .`;
  return `SELECT ?c ?pid ?v ?vLabel ?time ?share WHERE {
    ${which} FILTER NOT EXISTS { ?c wdt:P576 ?dissolved }
    VALUES ?pid { ${Object.keys(PROPS)
      .map((p) => `wd:${p}`)
      .join(" ")} }
    ?pid wikibase:claim ?claim ; wikibase:statementProperty ?sp .
    ?c ?claim ?st . ?st ?sp ?v ; wikibase:rank ?rank .
    FILTER(?rank != wikibase:DeprecatedRank)
    FILTER NOT EXISTS { ?st pq:P582 ?end }
    OPTIONAL { ?st pq:P585 ?time } OPTIONAL { ?st pq:P1107 ?share }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 800`;
}

/**
 * Turn the query's result rows into labelled sections. When a code matches
 * more than one item (a former state that kept its code, say), the item
 * with the most statements wins.
 * @param {object[]} bindings
 * @returns {CountryWikidata}
 */
export function parseFacts(bindings) {
  const byItem = new Map();
  for (const b of bindings) {
    const q = str(b.c?.value, 80).match(/^http:\/\/www\.wikidata\.org\/entity\/(Q\d{1,12})$/);
    if (!q) continue;
    if (!byItem.has(q[1])) byItem.set(q[1], []);
    byItem.get(q[1]).push(b);
  }
  let qid = null;
  let best = [];
  for (const [k, v] of byItem) {
    if (v.length > best.length) {
      qid = k;
      best = v;
    }
  }

  const values = {};
  for (const b of best) {
    const pid = str(b.pid?.value, 80).match(/\/(P\d{1,6})$/)?.[1];
    if (!pid || !PROPS[pid]) continue;
    let text = b.v?.type === "uri" ? str(b.vLabel?.value, 160) : str(b.v?.value, 160);
    // Unlabelled items come back as their id or address; they say nothing to a reader.
    if (!text || /^Q\d+$/.test(text) || /^https?:/.test(text)) continue;
    if (/^[+-]?\d{4,}-\d\d-\d\dT/.test(text)) text = String(parseInt(text, 10));
    const time = parseInt(str(b.time?.value, 40), 10);
    const share = parseFloat(str(b.share?.value, 30));
    (values[pid] ||= []).push({
      text,
      time: Number.isFinite(time) ? time : null,
      share: Number.isFinite(share) ? share : null,
    });
  }

  const out = { qid, basic: [], politics: [], people: [], more: [] };
  for (const [pid, [section, label, kind]] of Object.entries(PROPS)) {
    const vals = values[pid];
    if (!vals) continue;
    out[section].push([label, kind === "latest" ? latest(pid, vals) : listed(kind, vals)]);
  }
  return out;
}

/** The most recent of several dated values, with its year. */
function latest(pid, vals) {
  const v = vals.slice().sort((a, b) => (b.time ?? -1e9) - (a.time ?? -1e9))[0];
  const n = Number(v.text);
  let text = v.text;
  if (Number.isFinite(n)) {
    if (pid === "P1081") text = n.toFixed(3);
    else if (pid === "P2250") text = `${n.toFixed(1)} years`;
    else text = fmtNum(Math.round(n));
  }
  return text + (v.time != null ? ` (${v.time})` : "");
}

/** Several values, each once; shares largest first, with their percentage. */
function listed(kind, vals) {
  const seen = new Map();
  for (const v of vals) {
    const cur = seen.get(v.text);
    if (!cur || (v.share ?? -1) > (cur.share ?? -1)) seen.set(v.text, v);
  }
  const list = [...seen.values()];
  if (kind === "share") list.sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
  return list
    .slice(0, 12)
    .map((v) => {
      if (kind !== "share" || v.share == null) return v.text;
      // Shares are recorded both as fractions and as percentages.
      const pct = v.share <= 1 ? v.share * 100 : v.share;
      return `${v.text} (${pct.toFixed(v.share <= 0.1 ? 1 : 0)}%)`;
    })
    .join(", ");
}

/** Whether a cached value has the shape of {@link CountryWikidata}. */
export const isCountryWikidata = (v) =>
  Boolean(v) &&
  typeof v === "object" &&
  (v.qid === null || (shortString(v.qid, 20) && QID.test(v.qid))) &&
  SECTIONS.every(
    (k) =>
      Array.isArray(v[k]) &&
      v[k].length <= 100 &&
      v[k].every((r) => Array.isArray(r) && r.length === 2 && r.every((x) => shortString(x, 4000))),
  );

const cache = ttlCache("flagatlasmap.wikidata.v1", 7 * 864e5, 80, isCountryWikidata);

/**
 * A country's Wikidata facts, from the cache or the query service.
 * @param {string} code
 * @returns {Promise<CountryWikidata>}
 */
export async function countryFacts(code) {
  const hit = cache.get(code);
  if (hit) return hit;
  const facts = parseFacts(await sparql(factsQuery(code)));
  if (facts.qid) cache.put(code, facts);
  return facts;
}
