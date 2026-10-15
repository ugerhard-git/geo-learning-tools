// Builds the site into dist/, which is exactly what GitHub Pages serves.
//
// The site is plain HTML, CSS and native ES modules, so there is nothing to
// compile: the build copies src/ and then checks the copy. The checks are
// the useful part. They fail the build, and so the deployment, if
//
//   - a page's Content-Security-Policy is missing, misplaced or wider than
//     tools/site-checks.mjs allows, or the page carries anything the policy
//     would refuse (inline script or styles, event handlers, scripts or
//     stylesheets from another site);
//   - src/ holds a symbolic link, or a type of file the site has no use for,
//     or an SVG that could run script;
//   - anything points at a file that does not exist: a link, a stylesheet,
//     a script, an image, a module import or a url() in a stylesheet.
//
// It uses only Node's built-in modules, so the deployment can build without
// installing any packages.
//
//   npm run build

import { cp, lstat, readdir, readFile, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { PUBLISHABLE, checkPage, checkSvg } from "./site-checks.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "dist");

const problems = [];
const report = (base, file, message) => problems.push(`${relative(base, file)}: ${message}`);

/**
 * Every file under a directory. Symbolic links are reported, not followed:
 * the copy and the Pages upload would publish whatever they point at.
 */
async function walk(dir, base) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if ((await lstat(path)).isSymbolicLink()) report(base, path, "is a symbolic link");
    else if (entry.isDirectory()) out.push(...(await walk(path, base)));
    else out.push(path);
  }
  return out;
}

// Check the source before copying anything out of it.
for (const file of await walk(SRC, SRC)) {
  if (!PUBLISHABLE.has(extname(file).toLowerCase())) {
    report(SRC, file, `is not a type of file the site publishes (${[...PUBLISHABLE].join(" ")})`);
  }
}
if (problems.length) fail();

await rm(OUT, { recursive: true, force: true });
await cp(SRC, OUT, { recursive: true });
const files = await walk(OUT, OUT);

/**
 * Check that a reference from `file` resolves to a built file. Outside
 * addresses and in-page anchors are not this check's business; the page
 * checks decide which outside addresses a page may use.
 */
function checkRef(file, ref) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return;
  const path = ref.split(/[?#]/)[0];
  if (!path) return;
  let target = resolve(dirname(file), path);
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
  if (!target.startsWith(OUT) || !existsSync(target)) report(OUT, file, `refers to missing ${ref}`);
}

const pages = files.filter((f) => f.endsWith(".html"));

for (const page of pages) {
  const html = await readFile(page, "utf8");
  for (const problem of checkPage(html)) report(OUT, page, problem);
  for (const [, ref] of html.matchAll(/\s(?:href|src)="([^"]+)"/gi)) checkRef(page, ref);
}

for (const file of files.filter((f) => f.endsWith(".svg"))) {
  for (const problem of checkSvg(await readFile(file, "utf8"))) report(OUT, file, problem);
}

for (const file of files.filter((f) => f.endsWith(".js"))) {
  const js = await readFile(file, "utf8");
  for (const [, ref] of js.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/g)) {
    checkRef(file, ref);
  }
  for (const [, ref] of js.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) checkRef(file, ref);
}

for (const file of files.filter((f) => f.endsWith(".css"))) {
  const css = await readFile(file, "utf8");
  for (const [, ref] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) checkRef(file, ref);
}

if (problems.length) fail();
console.log(`Built ${pages.length} pages (${files.length} files) into ${relative(ROOT, OUT)}/`);

function fail() {
  console.error("Build checks failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
