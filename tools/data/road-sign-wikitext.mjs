// Reading sign drawings out of Wikipedia's "Road signs in …" articles: the
// signs the Roads app shows, and the drawings and captions in an article's
// wikitext. Pure functions, used by tools/data/road-signs.mjs and tested in
// test/unit/roads.test.js.

/** The signs, and the caption words that find each in an article's galleries. */
export const SIGNS = {
  chevron:
    /chevron|direction of (the )?(curve|bend)|curve (alignment|marker)|sharp (curve|bend|deviation)/i,
  pedestrian: /pedestrian crossing|zebra crossing|crosswalk/i,
  // The general warning sign (usually an exclamation mark), which shows the
  // country's warning sign style: a red-bordered triangle, a yellow diamond…
  warning:
    /other dangers?|general (warning|danger|caution)|danger ahead|^(caution|danger|warning)$|other hazards?/i,
  stop: /^(stop|stop sign|stop and give way)\b|\bstop\b(?! ahead| line| sign ahead)/i,
};

/**
 * Every drawing in an article with its caption: gallery lines
 * ("File:x.svg|Caption") and inline images ("[[File:x.svg|…|Caption]]").
 */
export function captionedFiles(wikitext) {
  const out = [];
  const clean = (s) =>
    s
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
      .replace(/'''?|<[^>]+>|\{\{[^}]*\}\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
  for (const m of wikitext.matchAll(/^\s*(?:File|Image):([^|\n]+?\.svg)\s*\|(.*)$/gim)) {
    out.push({ file: m[1].trim().replaceAll(" ", "_"), caption: clean(m[2]) });
  }
  // Inline images, as in tables: "| [[File:x.svg|80px]] || Stop". The caption
  // is the image's last parameter, unless that is only a size or position,
  // in which case it is the text that follows on the same line.
  const layout =
    /^(\d+(x\d+)?px|upright.*|thumb|frameless|center|left|right|none|alt=.*|link=.*)$/i;
  for (const line of wikitext.split("\n")) {
    for (const m of line.matchAll(/\[\[(?:File|Image):([^|\]]+?\.svg)((?:\|[^\]]*)?)\]\]/gi)) {
      const last = m[2].split("|").filter(Boolean).at(-1)?.trim() ?? "";
      const after = line
        .slice(m.index + m[0].length)
        .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "")
        .split("||")
        .map((s) => s.replace(/^[\s|!]+|\s+$/g, ""))
        .find(Boolean);
      const caption = last && !layout.test(last) ? last : (after ?? "");
      out.push({ file: m[1].trim().replaceAll(" ", "_"), caption: clean(caption) });
    }
  }
  return out.filter((f) => f.caption && f.caption.length <= 200);
}
