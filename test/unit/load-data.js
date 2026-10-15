// Lets the apps' data loaders run under Node: they fetch src/data/ files
// relative to their own module, which Node's fetch cannot do for file: URLs.
import { readFileSync } from "node:fs";

export function serveDataFromDisk() {
  globalThis.fetch = async (url) => {
    const body = readFileSync(new URL(url), "utf8");
    return { ok: true, json: async () => JSON.parse(body), text: async () => body };
  };
}
