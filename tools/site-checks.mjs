// The security checks the build runs on every page and file it publishes.
// Kept apart from tools/build.mjs so the unit tests can feed them pages that
// try to slip past (test/unit/site-checks.test.js).
//
// GitHub Pages cannot send response headers, so each page carries its
// Content-Security-Policy in a <meta> tag. That makes the policy part of the
// page, and so something a careless edit can weaken. These checks make sure
// it cannot happen quietly. They use only Node's built-ins on purpose: the
// build that produces the published site must not depend on third-party
// packages (see the build-pages job in .github/workflows/ci.yml).

/**
 * The only sources each directive may list. A page may list fewer (the
 * landing page needs no outside service at all), never more, and no other
 * directive may appear. Keep the outside hosts here in step with the README.
 */
export const ALLOWED = {
  "default-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
  "object-src": ["'none'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "font-src": ["'self'"],
  "img-src": ["'self'", "https://flagcdn.com"],
  "connect-src": [
    "'self'",
    "https://api.restcountries.com",
    "https://query.wikidata.org",
    "https://www.wikidata.org",
    "https://en.wikipedia.org",
  ],
};

/** Directives every page must have, with exactly this value. */
const REQUIRED = ["default-src", "base-uri", "form-action", "object-src"];
/** Directives a page that runs code must also have, with exactly this value. */
const REQUIRED_FOR_APPS = ["script-src", "style-src"];

/** File types the site may publish. Anything else fails the build. */
export const PUBLISHABLE = new Set([".html", ".js", ".css", ".json", ".txt", ".woff2", ".svg"]);

/** Elements that may come before the policy: it covers only what follows it. */
const BEFORE_POLICY = new Set(["html", "head", "meta", "title"]);

/**
 * Split HTML into its tags, with attribute names lower-cased. Comments are
 * removed first, so a policy inside a comment does not count. Anything that
 * starts like a tag but cannot be read as one is reported, rather than
 * skipped, so odd markup cannot hide from the checks.
 *
 * @param {string} html
 * @returns {{ tags: { name: string, closing: boolean, attrs: Map<string, string> }[], unreadable: string[], text: string }}
 */
export function readTags(html) {
  const text = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const tagPattern =
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
  const attrPattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const tags = [];
  const covered = new Set();
  for (const m of text.matchAll(tagPattern)) {
    covered.add(m.index);
    const attrs = new Map();
    for (const a of m[3].matchAll(attrPattern)) {
      const name = a[1].toLowerCase();
      // A repeated attribute: browsers keep the first, so do the same.
      if (!attrs.has(name)) attrs.set(name, a[2] ?? a[3] ?? a[4] ?? "");
    }
    tags.push({ name: m[2].toLowerCase(), closing: m[1] === "/", attrs, index: m.index });
  }
  const unreadable = [];
  for (const m of text.matchAll(/<\/?[a-zA-Z]/g)) {
    if (!covered.has(m.index)) unreadable.push(text.slice(m.index, m.index + 40));
  }
  return { tags, unreadable, text };
}

/**
 * Parse a policy into directives. Names are case-insensitive; a repeated
 * directive is reported, since browsers silently ignore all but the first.
 * @param {string} policy
 */
export function parsePolicy(policy) {
  const directives = new Map();
  const repeated = [];
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    if (directives.has(key)) repeated.push(key);
    else directives.set(key, sources);
  }
  return { directives, repeated };
}

/** Whether a reference stays on this site: relative, with no scheme and no host. */
export const isLocalRef = (ref) => !/^\s*([a-z][a-z0-9+.-]*:|\/\/|\\)/i.test(ref);

/**
 * Check one page.
 * @param {string} html
 * @returns {string[]} problems; empty when the page is fine
 */
export function checkPage(html) {
  const problems = [];
  const { tags, unreadable, text } = readTags(html);
  for (const u of unreadable) problems.push(`markup the checks cannot read: ${JSON.stringify(u)}`);
  const opening = tags.filter((t) => !t.closing);

  const metas = opening.filter((t) => t.name === "meta");
  const equiv = (t) => (t.attrs.get("http-equiv") ?? "").toLowerCase();
  const policies = metas.filter((t) => equiv(t) === "content-security-policy");
  const refresh = metas.find((t) => equiv(t) === "refresh");

  // The policy: exactly one, before anything it is meant to cover.
  if (policies.length !== 1) {
    problems.push(
      policies.length ? "more than one Content-Security-Policy" : "no Content-Security-Policy",
    );
  } else {
    const at = policies[0].index;
    const early = opening.find((t) => t.index < at && !BEFORE_POLICY.has(t.name));
    if (early) problems.push(`<${early.name}> comes before the Content-Security-Policy`);
    problems.push(...checkPolicy(policies[0].attrs.get("content") ?? "", Boolean(refresh)));
  }

  const referrer = metas.find((t) => (t.attrs.get("name") ?? "").toLowerCase() === "referrer");
  if (referrer?.attrs.get("content") !== "no-referrer") {
    problems.push('no <meta name="referrer" content="no-referrer">');
  }

  if (refresh) {
    const target = (refresh.attrs.get("content") ?? "").match(/^\s*\d+\s*;\s*url=(.*)$/i)?.[1];
    if (!target || !isLocalRef(target)) problems.push("refresh leads off the site");
  }

  // What the policy refuses must not be in the page; it would fail quietly.
  for (const t of opening) {
    if (t.name === "style") problems.push("<style> element");
    if (t.attrs.has("style")) problems.push(`style="" on <${t.name}>`);
    for (const name of t.attrs.keys()) {
      if (name.startsWith("on")) problems.push(`inline event handler ${name} on <${t.name}>`);
    }
    for (const name of ["href", "src", "action", "formaction", "srcset"]) {
      const value = t.attrs.get(name);
      if (value && /^\s*(javascript|data|vbscript):/i.test(value)) {
        problems.push(`${name}="${value.slice(0, 30)}…" on <${t.name}>`);
      }
    }
    if (t.name === "script") {
      const src = t.attrs.get("src");
      if (!src) problems.push("<script> without src");
      else if (!isLocalRef(src)) problems.push(`script from another site: ${src}`);
    }
    if (t.name === "link" && /stylesheet/i.test(t.attrs.get("rel") ?? "")) {
      const href = t.attrs.get("href") ?? "";
      if (!isLocalRef(href)) problems.push(`stylesheet from another site: ${href}`);
    }
    if (["iframe", "frame", "object", "embed", "base", "form"].includes(t.name)) {
      problems.push(`<${t.name}> element`);
    }
  }
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (m[1].trim()) problems.push("inline <script> content");
  }
  return problems;
}

/**
 * Check a policy against {@link ALLOWED}.
 * @param {string} policy
 * @param {boolean} redirect a forwarding page, which runs no code at all
 */
export function checkPolicy(policy, redirect) {
  const problems = [];
  const { directives, repeated } = parsePolicy(policy);
  for (const name of repeated) problems.push(`${name} appears twice`);
  const required = redirect ? REQUIRED : [...REQUIRED, ...REQUIRED_FOR_APPS];
  for (const name of required) {
    if (!directives.has(name)) problems.push(`no ${name}`);
  }
  for (const [name, sources] of directives) {
    const allowed = ALLOWED[name];
    if (!allowed) {
      problems.push(`${name} is not allowed`);
      continue;
    }
    if (redirect && !REQUIRED.includes(name)) problems.push(`${name} on a forwarding page`);
    if (!sources.length) problems.push(`${name} is empty`);
    if (REQUIRED.includes(name) || REQUIRED_FOR_APPS.includes(name) || name === "font-src") {
      if (sources.join(" ") !== allowed.join(" ")) {
        problems.push(`${name} must be exactly ${allowed.join(" ")}, not ${sources.join(" ")}`);
      }
    } else {
      for (const s of sources) {
        if (!allowed.includes(s)) problems.push(`${name} allows ${s}`);
      }
    }
  }
  return problems;
}

/**
 * Check an SVG file. A browser runs script in an SVG opened directly, and no
 * page's policy covers it, so published SVGs must be pictures and nothing
 * more.
 * @param {string} svg
 */
export function checkSvg(svg) {
  const problems = [];
  if (/<script\b/i.test(svg)) problems.push("<script> in an SVG");
  if (/<foreignObject\b/i.test(svg)) problems.push("<foreignObject> in an SVG");
  if (/\son[a-z]+\s*=/i.test(svg)) problems.push("event handler in an SVG");
  if (/(?:href|src)\s*=\s*["']?\s*(?:javascript|data):/i.test(svg)) {
    problems.push("script or data link in an SVG");
  }
  return problems;
}
