/**
 * The landing page: draws the world in the masthead, and reads each app's
 * saved progress to say what is due today.
 *
 * Progress is only read here, never written. It lives in this browser's
 * localStorage, which every page of the site (and every other project site
 * of the same GitHub account) can write to, so it is validated before use
 * (see cleanRecords in shared/leitner.js).
 *
 * @module landing
 */
import { $, $$, esc, fmtNum } from "../shared/dom.js";
import { loadData } from "../shared/net.js";
import { storage } from "../shared/storage.js";
import { unpackRing, ringsToPath } from "../shared/codec.js";
import { PROJECTIONS } from "../shared/projection.js";
import { KNOWN_BOX, cleanRecords, dayNumber } from "../shared/leitner.js";

/** How the counts in the "today" box name each app, in card order. */
const SHORT = ["Flags", "Countries", "Terrain", "Cities"];

drawMasthead();
showProgress();

/** A coarse world outline in the masthead (src/data/hero.txt, 12 units per degree). */
async function drawMasthead() {
  try {
    const text = await loadData("hero.txt", "text");
    const rings = text
      .trim()
      .split("|")
      .map((r) => unpackRing(r, 12));
    $("#globe").innerHTML = rings
      .map((r) => `<path d="${ringsToPath([r], PROJECTIONS.ee)}"/>`)
      .join("");
  } catch {
    // The masthead is decoration; the page works without it.
  }
}

/** Totals over one app's records, optionally only those of one drill. */
function tally(records, prefix = "") {
  const t = { seen: 0, known: 0, due: 0 };
  const today = dayNumber();
  for (const [key, rec] of records) {
    if (!key.startsWith(prefix)) continue;
    t.seen++;
    if (rec[0] >= KNOWN_BOX) t.known++;
    if (rec[1] <= today) t.due++;
  }
  return t;
}

function showProgress() {
  const cards = $$(".tool").map((el, i) => {
    const raw = storage.object(el.dataset.store);
    const records = cleanRecords(raw);
    const t = tally(records);
    fillCard(el, t, records);
    return {
      t,
      stored: raw !== null,
      name: $("h3", el).textContent,
      href: $(".go a", el).getAttribute("href"),
      short: SHORT[i],
    };
  });

  const head = $("#todayHead");
  const sub = $("#todaySub");
  const go = $("#todayGo");
  const anyStored = cards.some((c) => c.stored);
  const totalDue = cards.reduce((n, c) => n + c.t.due, 0);
  const practised = cards.reduce((n, c) => n + c.t.seen, 0);
  const most = cards.reduce((a, b) => (b.t.due > a.t.due ? b : a));

  if (!anyStored) {
    head.textContent = "Nothing tracked yet";
    sub.textContent =
      "Pick whichever appeals. Each app remembers what you get wrong and brings it back sooner.";
    go.textContent = "Start with flags";
    go.href = cards[0].href;
  } else if (totalDue) {
    head.textContent = `${fmtNum(totalDue)} ${totalDue === 1 ? "item is" : "items are"} due for review`;
    sub.textContent = `Most of them are in ${most.name}. Reviewing what is due is worth more than starting something new.`;
    go.textContent = `Review in ${most.name}`;
    go.href = most.href;
  } else if (practised) {
    head.textContent = "Nothing is due right now";
    sub.textContent = `You have practised ${fmtNum(practised)} ${practised === 1 ? "item" : "items"}. Come back when they fall due, or press on with new ones.`;
    const least = cards.slice().sort((a, b) => a.t.seen - b.t.seen)[0];
    go.textContent = "Learn something new";
    go.href = least.href;
  } else {
    head.textContent = "Ready when you are";
    sub.textContent = "Pick a tool below to begin.";
  }

  $("#todayPips").innerHTML = cards
    .map(
      (c) =>
        `<span class="pip${c.t.due ? "" : " zero"}"><b>${fmtNum(c.t.due)}</b> ${esc(c.short)}</span>`,
    )
    .join("");
}

/** The counts on one app's card, and its button. */
function fillCard(el, t, records) {
  const total = Number(el.dataset.total) || 0;
  $(".stats", el).innerHTML =
    `${t.due ? `<span class="due"><b>${fmtNum(t.due)}</b> due now</span>` : ""}
    <span><b>${fmtNum(t.seen)}</b> practised</span>
    <span><b>${fmtNum(t.known)}</b> known well${total ? ` of ${fmtNum(total)}` : ""}</span>`;

  // Apps with several drills say how much of each has been practised.
  const parts = (el.dataset.breakdown ?? "")
    .split("|")
    .filter(Boolean)
    .map((entry) => {
      const [prefix, label] = entry.split(":");
      const seen = tally(records, `${prefix}:`).seen;
      return seen ? `${label} ${fmtNum(seen)}` : null;
    })
    .filter(Boolean);
  if (parts.length) {
    $(".stats", el).insertAdjacentHTML(
      "afterend",
      `<p class="what breakdown">${esc(parts.join(" · "))}</p>`,
    );
  }

  const button = $(".go a", el);
  button.textContent = t.due ? `Review ${fmtNum(t.due)}` : t.seen ? "Continue" : "Open";
  button.classList.toggle("primary", t.due > 0);
}
