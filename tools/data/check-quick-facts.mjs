// Checks src/data/quick-facts.json (or the file named) before the workflow
// commits it: every place real, every value of the expected shape.
//
// It uses only Node's built-in modules on purpose: the workflow job that
// commits the file (.github/workflows/quick-facts.yml) can write to the
// repository, so it installs no npm packages and runs nothing but this.
//
//   node tools/data/check-quick-facts.mjs [quick-facts.json]

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * The problems with a quick-facts.json, or none.
 * @param {any} data parsed
 * @param {Set<string>} codes every place code in countries.txt
 */
export function checkQuickFacts(data, codes) {
  const problems = [];
  const facts = data?.facts;
  if (!facts || typeof facts !== "object") return ["no facts"];
  if (Object.keys(facts).length < 200) problems.push(`only ${Object.keys(facts).length} places`);
  for (const [code, f] of Object.entries(facts)) {
    const where = code.slice(0, 5);
    if (!codes.has(code)) problems.push(`${where}: not in countries.txt`);
    if (!Array.isArray(f?.tld) || !f.tld.every((t) => /^\.[a-z]{2}$/.test(t)))
      problems.push(`${where}: tld`);
    if (!Array.isArray(f?.phone) || !f.phone.every((p) => /^\+\d{1,4}( \d{1,4})?$/.test(p))) {
      problems.push(`${where}: phone`);
    }
    if (
      !Array.isArray(f?.currency) ||
      !f.currency.every(
        (c) =>
          /^[A-Z]{3}$/.test(c?.code) &&
          typeof c.name === "string" &&
          c.name.length <= 60 &&
          (c.symbol === undefined || (typeof c.symbol === "string" && c.symbol.length <= 6)),
      )
    ) {
      problems.push(`${where}: currency`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../../", import.meta.url);
  const file = process.argv[2] ?? fileURLToPath(new URL("src/data/quick-facts.json", root));
  const codes = new Set(
    (await readFile(new URL("src/data/countries.txt", root), "utf8"))
      .split("\n")
      .map((l) => l.split("|")[0]),
  );
  const data = JSON.parse(await readFile(file, "utf8").catch(() => "null"));
  const problems = checkQuickFacts(data, codes);
  if (problems.length) {
    console.error(problems.slice(0, 50).join("\n"));
    if (process.env.GITHUB_ACTIONS) {
      const text = problems.slice(0, 30).join("\n").replaceAll("%", "%25").replaceAll("\n", "%0A");
      console.log(`::error title=Quick facts::${text}`);
    }
    process.exit(1);
  }
  console.log(`${Object.keys(data.facts).length} places, all well formed.`);
}
