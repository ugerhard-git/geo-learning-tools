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
/** Headings of the warning sections. */
const WARNING = /warning|danger|caution|hazard/i;

/** Headings of sections that show signs no longer, or not normally, in use. */
const NOT_CURRENT =
  /histor|retired|obsolete|former|old |pre-|temporary|construction|roadworks|road markings|markings/i;

export const SIGNS = {
  chevron: {
    match:
      /chevron|curve alignment|alignment marker|direction of (the )?(curve|bend)|sharp deviation|deviation of (the )?(route|road)|hazard marker/i,
    avoid: /end of|roadworks|temporary/i,
    exact:
      /^(chevrons?( alignment)?( marker| sign| board)?|curve alignment( marker)?|direction of (the )?(curve|bend)|sharp deviation( of route)?)( (to the )?(left|right))?$/i,
  },
  // The pedestrian crossing has two signs in much of the world: a warning
  // that one is coming (a red-bordered triangle, a yellow diamond), and a
  // sign at the crossing itself (in Europe usually blue). Captions often name
  // both the same, so the heading a drawing sits under decides.
  pedestrian: {
    match: /pedestrian crossing|zebra crossing|crosswalk/i,
    avoid:
      /\bend\b|\bno\b|prohibit|forbidden|under(pass|ground)|over(pass|bridge)|bridge|subway|signal|light|school|children|yield|use |state law|direction/i,
    exact: /^(pedestrian|zebra) crossing( ahead)?$/i,
    where: (section, text) => WARNING.test(section) || /ahead/i.test(text),
  },
  crossing: {
    match: /pedestrian crossing|zebra crossing|crosswalk/i,
    avoid:
      /ahead|\bend\b|\bno\b|prohibit|forbidden|under(pass|ground)|over(pass|bridge)|bridge|subway|signal|light|school|children|yield|use |state law|direction/i,
    exact: /^(pedestrian|zebra) crossing$/i,
    where: (section) => Boolean(section) && !WARNING.test(section),
  },
  // The general warning sign (usually an exclamation mark), which shows the
  // country's warning sign style: a red-bordered triangle, a yellow diamond…
  warning: {
    match:
      /other dangers?|general (warning|danger|caution)|danger ahead|^(caution|danger|warning)$|other hazards?/i,
    avoid: /plate|panel|supplement|temporary|roadworks|end of/i,
    exact: /^(other dangers?|general (warning|danger|caution)|danger|other hazards?)$/i,
    // Not from the prohibitory signs (Kazakhstan's "Danger") or the plates
    // under a sign (Japan's "Caution").
    where: (section) => !/prohibit|regulat|supplement|additional|plate/i.test(section),
  },
  stop: {
    // Not "stopping" or "Stopschild"; a number may come straight after ("StopAlt. A").
    match: /(?<![A-Za-z])(?:[Ss]top|STOP)(?![a-z])/,
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
 * it, 2 it is the sign's name. Drawings under a heading for signs no longer
 * in use (historic, retired, temporary) never count, and one whose file name
 * says it is an old design ranks half a point lower.
 * @param {keyof typeof SIGNS} sign
 * @param {string} caption
 * @param {string} [file]
 * @param {string} [section] the headings it sits under
 */
export function signScore(sign, caption, file = "", section = "") {
  const { match, avoid, exact, where } = SIGNS[sign];
  const text = captionText(caption);
  if (!match.test(text) || avoid.test(text) || NOT_CURRENT.test(section)) return 0;
  if (where && !where(section, text)) return 0;
  const old = /(^|[^a-z])old([^a-z]|$)|former/i.test(file) ? 0.5 : 0;
  return (exact.test(text) ? 2 : 1) - old;
}

/**
 * Every drawing in an article with its caption and the headings it sits
 * under ("Warning signs / Other"): gallery lines ("File:x.svg|Caption") and
 * inline images ("[[File:x.svg|…|Caption]]").
 * @returns {{ file: string, caption: string, section: string }[]}
 */
export function captionedFiles(wikitext) {
  const out = [];
  const clean = (s) =>
    s
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
      .replace(/'''?|<[^>]+>|\{\{[^}]*\}\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
  // Inline images, as in tables: "| [[File:x.svg|80px]] || Stop". The caption
  // is the image's last parameter, unless that is only a size or position,
  // in which case it is the text that follows on the same line.
  const layout =
    /^(\d+(x\d+)?px|upright.*|thumb|frameless|center|left|right|none|alt=.*|link=.*)$/i;
  const headings = [];
  for (const line of wikitext.split("\n")) {
    const h = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (h) {
      headings.length = h[1].length - 2;
      headings.push(clean(h[2]));
      continue;
    }
    const section = headings.filter(Boolean).join(" / ");
    const gallery = /^\s*(?:File|Image):([^|\n]+?\.svg)\s*\|(.*)$/i.exec(line);
    if (gallery) {
      out.push({
        file: gallery[1].trim().replaceAll(" ", "_"),
        caption: clean(gallery[2]),
        section,
      });
      continue;
    }
    for (const m of line.matchAll(/\[\[(?:File|Image):([^|\]]+?\.svg)((?:\|[^\]]*)?)\]\]/gi)) {
      const last = m[2].split("|").filter(Boolean).at(-1)?.trim() ?? "";
      const after = line
        .slice(m.index + m[0].length)
        .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "")
        .split("||")
        .map((s) => s.replace(/^[\s|!]+|\s+$/g, ""))
        .find(Boolean);
      const caption = last && !layout.test(last) ? last : (after ?? "");
      out.push({ file: m[1].trim().replaceAll(" ", "_"), caption: clean(caption), section });
    }
  }
  return out.filter((f) => f.caption && f.caption.length <= 200);
}
