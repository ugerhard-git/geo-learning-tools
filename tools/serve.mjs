// A small static file server for local development and for the browser
// tests. It serves dist/ and nothing else.
//
// It deliberately adds no security headers. GitHub Pages cannot set custom
// headers either, so everything the apps rely on (their Content-Security-
// Policy, their referrer policy) has to live in the pages themselves. A
// server that added headers here would let a page pass its tests locally and
// then run unprotected in production.
//
//   npm start                  build, then serve on http://127.0.0.1:4173/
//   node tools/serve.mjs --port 8080

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const ROOT = join(new URL("..", import.meta.url).pathname, "dist");
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1]) || 4173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Map a request path to a file inside ROOT, or null if it would escape it. */
function resolve(urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const file = normalize(join(ROOT, path));
  return file === ROOT || file.startsWith(ROOT + sep) ? file : null;
}

const server = createServer(async (req, res) => {
  let file = resolve(req.url);
  if (!file) {
    res.writeHead(400).end("Bad request");
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    await stat(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

// Loopback only: this is a development server, not something to expose.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Serving dist/ on http://127.0.0.1:${PORT}/`);
});
