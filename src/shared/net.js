/**
 * Network access: this site's own data files, and the outside services the
 * detail panels draw on.
 * @module shared/net
 */

/** A response that came back with an error status. */
export class HttpError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/**
 * Settings for every request to another site: send no cookies or other
 * credentials, no Referer header revealing which page asked, and refuse to
 * follow redirects to somewhere other than the address requested.
 */
const OUTSIDE = {
  credentials: "omit",
  referrerPolicy: "no-referrer",
  mode: "cors",
  redirect: "error",
};

/**
 * Fetch JSON from another site.
 *
 * The response is untrusted: callers pick out the fields they need with
 * {@link str} and {@link num} rather than using it as is.
 *
 * @param {string} url
 * @param {RequestInit} [options] merged over the safe defaults
 */
export async function getJSON(url, options = {}) {
  const res = await fetch(url, { ...OUTSIDE, ...options });
  if (!res.ok) throw new HttpError(res.status);
  if (!/json/.test(res.headers.get("content-type") ?? "")) {
    throw new Error("Unexpected response type");
  }
  return res.json();
}

/** A string field from untrusted JSON, cut to `max` characters; anything else becomes "". */
export const str = (value, max = 400) => (typeof value === "string" ? value.slice(0, max) : "");

/** A finite number from untrusted JSON, or null. */
export const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Where this site keeps its data files, relative to this module. */
const DATA = new URL("../data/", import.meta.url);

/**
 * Load one of this site's own data files from src/data/.
 * @param {string} name file name, e.g. "countries.txt"
 * @param {"json" | "text"} [as]
 */
export async function loadData(name, as = "json") {
  const res = await fetch(new URL(name, DATA));
  if (!res.ok) throw new HttpError(res.status);
  return as === "text" ? res.text() : res.json();
}

/**
 * True when this page is shown inside another site's frame. Settings that
 * involve the API key are switched off then, so a framing page cannot trick
 * someone into typing their key into it. A frame we cannot even inspect
 * counts as foreign.
 */
export const FRAMED = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();
