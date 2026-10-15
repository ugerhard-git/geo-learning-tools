// The build's page checks must catch every way a page could weaken its
// policy. Several of these cases are bypasses the security audit found in an
// earlier, regex-based version of the checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkPage, checkPolicy, checkSvg, isLocalRef } from "../../tools/site-checks.mjs";

const GOOD_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";

/** A minimal page that passes, with pieces that a case can replace. */
function page({ policy = GOOD_POLICY, head = "", body = "", before = "" } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8">${before}<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><title>t</title>${head}</head><body>${body}<script type="module" src="app.js"></script></body></html>`;
}

const fails = (html, pattern) => {
  const problems = checkPage(html);
  assert.ok(
    problems.some((p) => pattern.test(p)),
    `expected a problem matching ${pattern}, got ${JSON.stringify(problems)}`,
  );
};

test("a well-formed page passes", () => {
  assert.deepEqual(checkPage(page()), []);
});

test("every page the site ships passes", () => {
  for (const path of [
    "index.html",
    "city-atlas/index.html",
    "terrain-atlas/index.html",
    "flag-atlas/index.html",
    "flag-atlas-map/index.html",
    "city-atlas.html",
  ]) {
    const html = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
    assert.deepEqual(checkPage(html), [], path);
  }
});

test("a policy inside a comment does not count", () => {
  const html = page().replace(/<meta http-equiv[^>]*>/, (m) => `<!-- ${m} -->`);
  fails(html, /no Content-Security-Policy/);
});

test("a policy must come before anything it is meant to cover", () => {
  fails(
    page({ before: '<script src="https://cdn.example/x.js"></script>' }),
    /<script> comes before/,
  );
  fails(page({ before: '<link rel="stylesheet" href="a.css">' }), /<link> comes before/);
});

test("only one policy", () => {
  fails(
    page({ head: `<meta http-equiv="content-security-policy" content="${GOOD_POLICY}">` }),
    /more than one/,
  );
});

test("directives that would re-open inline code are refused", () => {
  fails(
    page({ policy: `${GOOD_POLICY}; script-src-attr 'unsafe-inline'` }),
    /script-src-attr is not allowed/,
  );
  fails(
    page({ policy: `${GOOD_POLICY}; style-src-elem 'unsafe-inline'` }),
    /style-src-elem is not allowed/,
  );
  fails(
    page({ policy: GOOD_POLICY.replace("script-src 'self'", "script-src 'self' data:") }),
    /script-src must be exactly/,
  );
  fails(
    page({ policy: GOOD_POLICY.replace("script-src 'self'", "SCRIPT-SRC *") }),
    /script-src must be exactly/,
  );
  fails(
    page({ policy: GOOD_POLICY.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") }),
    /style-src must be exactly/,
  );
});

test("outside hosts must be on the list, and repeated directives are refused", () => {
  fails(
    page({ policy: GOOD_POLICY.replace("connect-src 'self'", "connect-src 'self' https:") }),
    /connect-src allows https:/,
  );
  fails(page({ policy: GOOD_POLICY.replace("img-src 'self'", "img-src *") }), /img-src allows \*/);
  fails(page({ policy: `${GOOD_POLICY}; script-src *` }), /script-src appears twice/);
  assert.deepEqual(
    checkPolicy(
      GOOD_POLICY.replace("connect-src 'self'", "connect-src 'self' https://query.wikidata.org"),
      false,
    ),
    [],
  );
});

test("inline code in any spelling is refused", () => {
  fails(
    page({ body: "<SCRIPT>alert(1)</SCRIPT>" }),
    /<script> without src|inline <script> content/,
  );
  fails(page({ body: '<div STYLE="color:red"></div>' }), /style="" on <div>/);
  fails(page({ body: "<img src=x ONERROR=alert(1)>" }), /inline event handler onerror/);
  fails(page({ body: "<style>p{}</style>" }), /<style> element/);
  fails(page({ body: '<a href="JavaScript:alert(1)">x</a>' }), /href="JavaScript/);
  fails(page({ body: '<script data-src="x.js"></script>' }), /<script> without src/);
});

test("scripts and stylesheets come from this site only", () => {
  fails(
    page({ head: '<link rel="stylesheet" href="https://cdn.example/a.css">' }),
    /stylesheet from another site/,
  );
  fails(page({ body: '<script src="//cdn.example/a.js"></script>' }), /script from another site/);
});

test("markup the checks cannot read fails rather than slipping through", () => {
  fails(page({ body: '<div class="a"b="c">x</div>' }), /cannot read/);
});

test("forwarding pages lead only within the site", () => {
  const stub = (target) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0; url=${target}"><title>moved</title></head><body></body></html>`;
  assert.deepEqual(checkPage(stub("city-atlas/")), []);
  fails(stub("https://evil.example/"), /refresh leads off the site/);
  fails(stub("//evil.example/"), /refresh leads off the site/);
});

test("the referrer policy is required", () => {
  fails(page().replace('<meta name="referrer" content="no-referrer">', ""), /referrer/);
});

test("SVGs must not carry script", () => {
  assert.deepEqual(checkSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'), []);
  assert.ok(checkSvg("<svg><script>alert(1)</script></svg>").length);
  assert.ok(checkSvg('<svg onload="alert(1)"></svg>').length);
  assert.ok(checkSvg("<svg><foreignObject></foreignObject></svg>").length);
});

test("local references have no scheme and no host", () => {
  assert.ok(isLocalRef("city-atlas/"));
  assert.ok(isLocalRef("../shared/dom.js"));
  assert.ok(!isLocalRef("https://example.com/"));
  assert.ok(!isLocalRef("//example.com/"));
  assert.ok(!isLocalRef(" javascript:alert(1)"));
});
