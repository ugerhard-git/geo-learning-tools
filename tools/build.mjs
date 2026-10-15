// Builds the site into dist/, which is exactly what GitHub Pages serves.
//
// The site is plain HTML, CSS and native ES modules, so there is nothing to
// compile: the build copies src/ and then checks the copy. The checks are
// the useful part. They fail the build, and so the deployment, if
//
//   - a page ships without its Content-Security-Policy, or with one that
//     allows inline script or inline styles;
//   - a page contains inline script, a style="" attribute, a <style>
//     element or an inline event handler, all of which that policy would
//     refuse at run time (so the page would be quietly broken);
//   - anything points at a file that does not exist: a link, a stylesheet,
//     a script, an image, a module import or a url() in a stylesheet.
//
//   npm run build

import { cp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "dist");

await rm(OUT, { recursive: true, force: true });
await cp(SRC, OUT, { recursive: true });

/** Every file under a directory, as absolute paths. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const files = await walk(OUT);
const problems = [];
const report = (file, message) => problems.push(`${relative(OUT, file)}: ${message}`);

/**
 * Check that a reference from `file` resolves to a built file. Outside
 * addresses, data: URIs and in-page anchors are not this check's business.
 */
function checkRef(file, ref) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return;
  const path = ref.split(/[?#]/)[0];
  if (!path) return;
  let target = resolve(dirname(file), path);
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
  if (!target.startsWith(OUT) || !existsSync(target)) report(file, `refers to missing ${ref}`);
}

const pages = files.filter((f) => f.endsWith(".html"));

for (const page of pages) {
  const html = await readFile(page, "utf8");
  const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1];
  const redirect = /<meta\s+http-equiv="refresh"/.test(html);

  // GitHub Pages cannot send response headers, so each page carries its
  // policy in a <meta> tag. A page without one would run with no CSP at all.
  if (!csp) {
    report(page, "no Content-Security-Policy");
  } else {
    const directive = (name) => csp.match(new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`))?.[1];
    if (directive("default-src")?.trim() !== "'none'") report(page, "default-src is not 'none'");
    if (!redirect) {
      for (const name of ["script-src", "style-src"]) {
        const value = directive(name);
        if (!value) report(page, `CSP has no ${name}`);
        else if (/'unsafe-|'sha\d+-|'nonce-/.test(value)) {
          report(page, `${name} allows inline code: ${value.trim()}`);
        }
      }
    }
    for (const name of ["base-uri", "form-action", "object-src"]) {
      if (directive(name)?.trim() !== "'none'") report(page, `${name} is not 'none'`);
    }
  }

  // What the policy refuses must not be in the page: it would fail silently.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (m[2].trim()) report(page, "inline <script> content");
    if (!/\bsrc=/.test(m[1])) report(page, "<script> without src");
  }
  if (/<style[\s>]/.test(html)) report(page, "<style> element");
  if (/\sstyle=/.test(html)) report(page, 'style="" attribute');
  if (/<[^>]+\son[a-z]+\s*=/i.test(html)) report(page, "inline event handler");

  for (const [, ref] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) checkRef(page, ref);
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

if (problems.length) {
  console.error("Build checks failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Built ${pages.length} pages (${files.length} files) into ${relative(ROOT, OUT)}/`);
