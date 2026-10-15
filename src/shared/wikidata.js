/**
 * Requests to Wikidata and Wikipedia for the detail panels.
 *
 * All three endpoints answer cross-origin requests without credentials
 * (`origin=*`). Everything they return is community-edited and untrusted:
 * callers take strings out with {@link str} and escape them before display.
 *
 * @module shared/wikidata
 */
import { HttpError, getJSON, str } from "./net.js";

/** A Wikidata item id, e.g. "Q90". Checked before any id goes into a URL. */
export const QID = /^Q\d{1,12}$/;

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const SPARQL = "https://query.wikidata.org/sparql";

/**
 * One Wikidata entity.
 * @param {string} qid
 * @param {string} props which parts to fetch, e.g. "claims|sitelinks|descriptions"
 * @returns {Promise<object>} the entity, or {} if missing
 */
export async function fetchEntity(qid, props) {
  if (!QID.test(qid)) throw new Error("Not a Wikidata id");
  const url = `${WIKIDATA_API}?action=wbgetentities&format=json&origin=*&props=${encodeURIComponent(props)}&languages=en&sitefilter=enwiki&ids=${qid}`;
  const json = await getJSON(url);
  return json?.entities?.[qid] ?? {};
}

/**
 * English labels for up to 50 entities (the most one request may ask for).
 * @param {string[]} qids
 * @returns {Promise<Map<string, string>>}
 */
export async function fetchLabels(qids) {
  const ids = qids.filter((q) => QID.test(q)).slice(0, 50);
  const out = new Map();
  if (!ids.length) return out;
  const json = await getJSON(
    `${WIKIDATA_API}?action=wbgetentities&format=json&origin=*&props=labels&languages=en&ids=${ids.join("|")}`,
  );
  for (const id of ids) {
    const label = str(json?.entities?.[id]?.labels?.en?.value, 120);
    if (label) out.set(id, label);
  }
  return out;
}

/**
 * The introduction of an English Wikipedia article as plain text, with the
 * Wikidata id of the article's subject.
 * @param {string} title
 * @returns {Promise<{ title: string, extract: string, qid: string } | null>} null if no such article
 */
export async function fetchIntro(title) {
  const url = `${WIKIPEDIA_API}?action=query&format=json&origin=*&redirects=1&prop=extracts|pageprops&exintro=1&explaintext=1&ppprop=wikibase_item&titles=${encodeURIComponent(title)}`;
  const json = await getJSON(url);
  const page = Object.values(json?.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined || typeof page.extract !== "string") return null;
  const qid = str(page.pageprops?.wikibase_item, 20);
  return {
    title: str(page.title, 200) || title,
    extract: page.extract.slice(0, 4000),
    qid: QID.test(qid) ? qid : "",
  };
}

/**
 * Run a SPARQL query against the Wikidata query service.
 * @param {string} query
 * @returns {Promise<object[]>} the result bindings
 */
export async function sparql(query) {
  const json = await getJSON(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`);
  return Array.isArray(json?.results?.bindings) ? json.results.bindings : [];
}

/** A link to an English Wikipedia article. */
export const wikipediaUrl = (title) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/** A link to an English Wikipedia search. */
export const wikipediaSearchUrl = (text) =>
  `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(text)}`;

/** A link to a Wikidata item. */
export const wikidataUrl = (qid) =>
  QID.test(qid) ? `https://www.wikidata.org/wiki/${qid}` : "https://www.wikidata.org/";

/**
 * What to tell the learner when Wikidata did not answer.
 * @param {unknown} e
 * @param {string} thing what to reopen, e.g. "the feature"
 */
export const wikidataErrorText = (e, thing) =>
  e instanceof HttpError && e.status === 429
    ? `Wikidata is rate-limiting requests. Wait a minute and reopen ${thing}.`
    : `Wikidata couldn't be reached. Check your connection and reopen ${thing}.`;
