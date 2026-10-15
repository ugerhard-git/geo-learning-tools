// Builds the site into dist/, which is exactly what GitHub Pages serves.
//
// For now the apps are single, pre-built HTML files in public/, so the build
// copies them and then checks the result. The checks are the useful part:
// they fail the build, and so the deployment, if a page ships without its
// Content-Security-Policy or links to a file that does not exist.
//
//   npm run build

import { cp, readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "public");
const OUT = join(ROOT, "dist");

await rm(OUT, { recursive: true, force: true });
await cp(SRC, OUT, { recursive: true });

const pages = (await readdir(OUT)).filter((f) => f.endsWith(".html"));
const problems = [];

for (const page of pages) {
  const html = await readFile(join(OUT, page), "utf8");

  // GitHub Pages cannot send response headers, so each page carries its
  // policy in a <meta> tag. A page without one would run with no CSP at all.
  if (!/<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'/.test(html)) {
    problems.push(`${page}: no Content-Security-Policy with default-src 'none'`);
  }

  // Every same-site link must point at a file that was built.
  for (const [, href] of html.matchAll(/href="([^"#?:]+\.html)"/g)) {
    if (!existsSync(join(OUT, href))) problems.push(`${page}: links to missing ${href}`);
  }
}

if (problems.length) {
  console.error("Build checks failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Built ${pages.length} pages into ${relative(ROOT, OUT)}/`);
