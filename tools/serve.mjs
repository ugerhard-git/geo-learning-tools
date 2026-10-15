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
import { realpath, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const ROOT = join(new URL("..", import.meta.url).pathname, "dist");
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1]) || 4173;

/**
 * The only Host headers answered. A web page elsewhere can point a domain of
 * its own at 127.0.0.1 ("DNS rebinding") and then read from this server as
 * if it were that domain; such requests carry the other domain as Host.
 */
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

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

const inside = (root, file) => file === root || file.startsWith(root + sep);

/** Map a request path to a file inside ROOT, or null if it would escape it. */
function resolve(urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  const file = normalize(join(ROOT, path));
  return inside(ROOT, file) ? file : null;
}

/**
 * The file to send for a path, or null. The real path is checked as well,
 * so a symbolic link inside dist/ cannot lead out of it.
 */
async function find(file) {
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const real = await realpath(file);
    const root = await realpath(ROOT);
    return inside(root, real) && (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (!HOSTS.has(req.headers.host ?? "")) {
    res.writeHead(421, { "Content-Type": "text/plain" }).end("Unknown host");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain" }).end("Not allowed");
    return;
  }
  const requested = resolve(req.url);
  if (!requested) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad request");
    return;
  }
  const file = await find(requested);
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(file);
  // A file that vanishes or cannot be read mid-way ends the response rather
  // than the server.
  stream.on("error", () => res.destroy());
  stream.pipe(res);
});

// Loopback only: this is a development server, not something to expose.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Serving dist/ on http://127.0.0.1:${PORT}/`);
});
