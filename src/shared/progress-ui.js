/**
 * The progress screen every app shows, and the dialog that moves progress
 * between devices as copy-and-paste text.
 *
 * An app with several drills (City Atlas, Terrain Atlas) gets a table with
 * a row per drill; an app with one (the flag apps) gets a coverage bar and
 * a count per Leitner box instead.
 *
 * @module shared/progress-ui
 */
import { BOXES, KNOWN_BOX } from "./leitner.js";
import { esc, fmtNum } from "./dom.js";
import { FRAMED } from "./net.js";

/**
 * Erasing and importing change saved progress, so they are refused while the
 * page is shown inside another site's frame: that site could overlay the
 * buttons and trick a learner into clicking them.
 */
const FRAMED_MESSAGE = "Open this page in its own tab to change your saved progress.";

/**
 * @typedef {object} DrillKeys
 * @property {string} label e.g. "Locate"
 * @property {string[]} keys the progress key of every item in this drill
 */

/**
 * @typedef {object} ProgressOptions
 * @property {import("./leitner.js").ProgressStore} store
 * @property {string} appName shown in the export dialog, e.g. "City Atlas"
 * @property {() => DrillKeys[]} drills what to report on, worked out afresh each time
 * @property {(key: string) => { label: string, look: string } | null} describe the name
 *   of the item behind a progress key, and an id that `onLook` understands
 * @property {(look: string) => void} onLook open an item's details
 * @property {string} [lead] a line under the heading
 * @property {string} [footer] extra buttons (HTML) after the data actions
 * @property {boolean} [closeButton] show a close button (for a dialog)
 * @property {() => void} [onErase] after all progress was erased
 */

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

export class ProgressView {
  /**
   * @param {HTMLElement} root where the screen is drawn
   * @param {ProgressOptions} options
   */
  constructor(root, options) {
    this.root = root;
    this.o = options;
    this.transfer = createTransferDialog(options.store, options.appName, () => this.render());

    root.addEventListener("click", (e) => {
      const look = e.target.closest("[data-look]");
      if (look) return this.o.onLook(look.dataset.look);
      if (e.target.closest("[data-export]")) return this.transfer.open("export");
      if (e.target.closest("[data-import]")) return this.transfer.open("import");
      if (e.target.closest("[data-erase]")) return this.erase();
    });
  }

  /** Two clicks are needed to erase, the first one arms the second. */
  erase() {
    const status = this.root.querySelector("[data-pstatus]");
    if (FRAMED) {
      status.className = "status bad";
      status.textContent = FRAMED_MESSAGE;
      return;
    }
    if (status.dataset.armed !== "1") {
      status.dataset.armed = "1";
      status.className = "status bad";
      status.textContent = "Click again to erase all progress. This cannot be undone.";
      return;
    }
    this.o.store.erase();
    this.o.onErase?.();
    this.render();
    const after = this.root.querySelector("[data-pstatus]");
    after.className = "status ok";
    after.textContent = "All progress erased.";
  }

  render() {
    const { store } = this.o;
    const drills = this.o.drills();
    const all = drills.flatMap((d) => d.keys);
    const s = store.stats(all);

    const tiles = [
      [fmtNum(s.seen), "practised"],
      [fmtNum(s.learned), "known well"],
      [fmtNum(s.due), "due for review"],
      [`${s.tries ? Math.round((1 - s.wrong / s.tries) * 100) : 0}%`, "answered right"],
      [fmtNum(s.tries), "questions answered"],
    ];

    const body = drills.length > 1 ? this.byDrill(drills) : this.byBox(drills[0]?.keys ?? [], s);

    this.root.innerHTML = `
      ${this.o.closeButton ? `<button class="close" aria-label="Close" data-close>×</button>` : ""}
      <h2>Progress</h2>
      ${this.o.lead ? `<p class="pg-lead">${esc(this.o.lead)}</p>` : ""}
      <div class="pg-stats">${tiles
        .map(([value, label]) => `<div class="pg-stat"><b>${value}</b><span>${label}</span></div>`)
        .join("")}</div>
      ${body}
      <p class="pg-src">“Known well” means box ${KNOWN_BOX} or ${BOXES.length} of ${BOXES.length}, so an item will not come round again for a couple of weeks.</p>
      <h3>Worth another look</h3>
      ${this.troublesome(drills)}
      <h3>Your data</h3>
      <p class="pg-src">Progress lives in this browser only and is never sent anywhere. Export it to move it to another device or keep a backup.</p>
      ${
        store.saveFailed
          ? `<p class="status bad">This browser would not save your latest answers (its storage may be full or turned off). They count for now but will be lost when the page closes.</p>`
          : ""
      }
      <div class="actions">
        <button class="btn" data-export>Export</button>
        <button class="btn" data-import>Import</button>
        <button class="btn" data-erase>Erase all progress</button>
        ${this.o.footer ?? ""}
      </div>
      <p class="status" data-pstatus role="status"></p>`;

    // Bar widths are set through the DOM: the Content-Security-Policy refuses
    // style="" attributes in markup, but not styles set from script.
    for (const bar of this.root.querySelectorAll("[data-pct]")) {
      bar.style.width = `${bar.dataset.pct}%`;
    }
  }

  /** @param {DrillKeys[]} drills */
  byDrill(drills) {
    const rows = drills.map(({ label, keys }) => {
      const s = this.o.store.stats(keys);
      return `<tr><td>${esc(label)}</td>
        <td class="pg-num">${fmtNum(s.seen)} / ${fmtNum(s.total)}</td>
        <td class="pg-num">${fmtNum(s.learned)}</td>
        <td class="pg-num">${fmtNum(s.due)}</td>
        <td><span class="pg-bar"><i data-pct="${percent(s.learned, s.total)}"></i></span></td></tr>`;
    });
    return `<h3>By drill</h3>
      <table class="pg-table"><thead><tr><th>Drill</th><th>Practised</th><th>Known well</th><th>Due</th><th class="pg-cover">Coverage</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table>`;
  }

  /** @param {string[]} keys */
  byBox(keys, s) {
    const pct = percent(s.learned, s.total);
    const counts = this.o.store.perBox(keys);
    return `<h3>Coverage</h3>
      <p class="pg-bar-row"><span class="pg-bar"><i data-pct="${pct}"></i></span>
        <span class="pg-bar-lab">${fmtNum(s.learned)} of ${fmtNum(s.total)} known well (${pct}%)</span></p>
      <table class="pg-table"><thead><tr><th>Box</th><th>Comes round again</th><th>Items</th></tr></thead><tbody>
      ${counts
        .map(
          (n, i) =>
            `<tr><td>${i + 1}</td><td>${BOXES[i] === 0 ? "straight away" : `after ${BOXES[i]} days`}</td><td class="pg-num">${fmtNum(n)}</td></tr>`,
        )
        .join("")}
      </tbody></table>`;
  }

  /** @param {DrillKeys[]} drills */
  troublesome(drills) {
    const several = drills.length > 1;
    const list = drills
      .flatMap((d) => this.o.store.troublesome(d.keys).map((t) => ({ ...t, drill: d.label })))
      .sort((a, b) => b.wrong / b.tries - a.wrong / a.tries || b.wrong - a.wrong)
      .slice(0, 30);
    const buttons = list
      .map((t) => {
        const item = this.o.describe(t.key);
        if (!item) return "";
        const title = `${several ? `${t.drill}: ` : ""}wrong ${t.wrong} of ${t.tries}`;
        return `<button data-look="${esc(item.look)}" title="${esc(title)}">${esc(item.label)} <span class="pg-wn">${t.wrong}/${t.tries}</span></button>`;
      })
      .join("");
    return buttons
      ? `<div class="pg-weak">${buttons}</div>`
      : `<p class="err">Nothing is giving you trouble yet. Items appear here once you have missed them a few times.</p>`;
  }
}

/**
 * The export/import dialog, built once and added to the page.
 *
 * @param {import("./leitner.js").ProgressStore} store
 * @param {string} appName
 * @param {() => void} onImported
 */
export function createTransferDialog(store, appName, onImported) {
  const dlg = document.createElement("dialog");
  dlg.setAttribute("aria-labelledby", "transferTitle");
  dlg.innerHTML = `<div class="dlg">
    <button class="close" aria-label="Close" data-close>×</button>
    <h2 id="transferTitle"></h2>
    <p data-lead></p>
    <textarea class="pg-io" spellcheck="false" aria-label="Progress data"></textarea>
    <div class="actions spaced-s"><button class="btn primary" data-act></button><button class="btn" data-close>Cancel</button></div>
    <p class="status" role="status"></p>
  </div>`;
  document.body.append(dlg);

  const text = dlg.querySelector("textarea");
  const act = dlg.querySelector("[data-act]");
  const status = dlg.querySelector(".status");
  const say = (msg, cls) => {
    status.textContent = msg;
    status.className = `status ${cls}`;
  };
  let mode = "export";

  act.addEventListener("click", () => {
    if (mode === "export") {
      text.select();
      say("Selected, copy it now.", "ok");
      return;
    }
    if (FRAMED) {
      say(FRAMED_MESSAGE, "bad");
      return;
    }
    const result = store.importText(text.value);
    if (!result.ok) {
      say(
        result.error === "json"
          ? "That is not valid exported data."
          : `That does not look like a ${appName} export.`,
        "bad",
      );
      return;
    }
    say(`Imported. ${result.added} new, ${result.updated} updated.`, "ok");
    onImported();
  });

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });

  return {
    /** @param {"export" | "import"} which */
    open(which) {
      mode = which;
      const out = which === "export";
      dlg.querySelector("h2").textContent = out ? "Export your progress" : "Import progress";
      dlg.querySelector("[data-lead]").textContent = out
        ? `Copy this text and keep it somewhere safe, or paste it into ${appName} on another device.`
        : "Paste an exported block here. Where both sides know an item, whichever record is further along wins.";
      act.textContent = out ? "Select all" : "Import";
      text.value = out ? store.exportText() : "";
      text.readOnly = out;
      status.textContent = "";
      status.className = "status";
      if (!dlg.open) dlg.showModal();
    },
  };
}
