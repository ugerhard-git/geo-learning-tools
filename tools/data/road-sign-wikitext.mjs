// Reading sign drawings out of Wikipedia's "Road signs in …" articles: the
// signs the Roads app shows, and the drawings and captions in an article's
// wikitext. Pure functions, used by tools/data/road-signs.mjs and tested in
// test/unit/roads.test.js.

/**
 * The signs, and how a caption names each: `match` must be in it, `avoid`
 * must not, and a caption that is only the sign's name (`exact`) ranks
 * first. Captions often start with the sign's number ("R1-1Stop",
 * "3.01 Stop"), which {@link captionText} takes off first.
 */
export const SIGNS = {
  chevron: {
    match:
      /chevron|curve alignment|alignment marker|direction of (the )?(curve|bend)|sharp deviation|deviation of (the )?(route|road)|hazard marker/i,
    avoid: /end of|roadworks|temporary/i,
    exact:
      /^(chevrons?( alignment)?( marker| sign| board)?|curve alignment( marker)?|direction of (the )?(curve|bend)|sharp deviation( of route)?)( (to the )?(left|right))?$/i,
  },
  pedestrian: {
    match: /pedestrian crossing|zebra crossing|crosswalk/i,
    avoid:
      /\bend\b|\bno\b|prohibit|forbidden|under(pass|ground)|over(pass|bridge)|bridge|subway|signal|light|school|children|yield|use |state law|direction/i,
    exact: /^(pedestrian|zebra) crossing( ahead)?$/i,
  },
  // The general warning sign (usually an exclamation mark), which shows the
  // country's warning sign style: a red-bordered triangle, a yellow diamond…
  warning: {
    match:
      /other dangers?|general (warning|danger|caution)|danger ahead|^(caution|danger|warning)$|other hazards?/i,
    avoid: /plate|panel|supplement|temporary|roadworks|end of/i,
    exact: /^(other dangers?|general (warning|danger|caution)|danger|other hazards?)$/i,
  },
  stop: {
    match: /(?<![a-z])stop(?![a-z])/i,
    avoid:
      /ahead|bus|tram|taxi|truck|lrt|parking|wait|do not|don't|police|customs|control|announce|\d+ ?m\b|distance|prepared|line|crossing|children|manual|temporary|school|old|previous|\b(18|19|20)\d\d\b|on red|patrol|\bgo\b|tracks|end of|repetition|validity/i,
    exact: /^stop( sign)?( and give way)?$/i,
  },
};

/** A caption without the sign's number in front: "R1-1Stop" → "Stop". */
export const captionText = (caption) =>
  caption.replace(/^(?:[Ss]ign\s+)?\S*\d[^\s:]*?\s*:?\s*(?=\p{Lu})/u, "").trim();

/**
 * How well a drawing's caption names a sign: 0 not at all, 1 it mentions
 * it, 2 it is the sign's name. A drawing whose file name says it is an old
 * design ranks half a point lower.
 * @param {keyof typeof SIGNS} sign
 * @param {string} caption
 * @param {string} [file]
 */
export function signScore(sign, caption, file = "") {
  const { match, avoid, exact } = SIGNS[sign];
  const text = captionText(caption);
  if (!match.test(text) || avoid.test(text)) return 0;
  const old = /(^|[^0-9])(1[89]\d\d|200\d)([^0-9]|$)|(^|[^a-z])old([^a-z]|$)|former/i.test(file)
    ? 0.5
    : 0;
  return (exact.test(text) ? 2 : 1) - old;
}

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
