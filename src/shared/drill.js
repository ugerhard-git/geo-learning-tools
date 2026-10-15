/**
 * The drill: a session of questions shown in a bar along the bottom of the
 * map, as the Cities and Regions and the Terrain apps use it.
 *
 * The session owns what is the same in every drill: the queue, the score,
 * recording each answer, asking a missed item again a few questions later,
 * the bar's markup, multiple choice, typed answers, the optional hint,
 * keyboard shortcuts and the summary at the end. The app owns everything
 * about its items: it turns an item into a {@link Question}, judges typed
 * answers and clicks on the map, and decides what the map shows.
 *
 * @module shared/drill
 */
import { esc } from "./dom.js";
import { randomInt, shuffle } from "./random.js";

/** Session lengths offered in the setup screen; 0 keeps going until stopped. */
export const SESSION_LENGTHS = [
  [10, "10 questions"],
  [20, "20 questions"],
  [40, "40 questions"],
  [0, "Keep going"],
];

/** A stored session length, or the default. */
export function cleanLength(value) {
  // Checked for null first: Number(null) is 0, which would read as "keep going".
  if (value == null) return 20;
  const n = Number(value);
  return SESSION_LENGTHS.some(([k]) => k === n) ? n : 20;
}

/** HTML for the session-length select. */
export const lengthSelect = (current) =>
  `<select id="dLen" aria-label="Session length">${SESSION_LENGTHS.map(
    ([n, label]) => `<option value="${n}"${n === current ? " selected" : ""}>${label}</option>`,
  ).join("")}</select>`;

/**
 * HTML for an easy/hard switch.
 * @param {boolean} hard
 * @param {string} easy label for multiple choice
 * @param {string} typed label for typing the answer
 */
export const difficultySwitch = (hard, easy, typed) =>
  `<div class="seg" role="group" aria-label="Difficulty"><button data-hard="0" aria-pressed="${!hard}">${esc(easy)}</button><button data-hard="1" aria-pressed="${hard}">${esc(typed)}</button></div>`;

/**
 * HTML for the drill-type buttons.
 * @param {Record<string, { label: string, blurb: string }>} drills
 * @param {string} current
 */
export const typeButtons = (drills, current) =>
  `<div class="types" role="group" aria-label="Drill type">${Object.entries(drills)
    .map(
      ([k, v]) =>
        `<button data-type="${k}" aria-pressed="${k === current}"><b>${esc(v.label)}</b><span>${esc(v.blurb)}</span></button>`,
    )
    .join("")}</div>`;

/**
 * The line under the setup that says how big the set is, and the buttons
 * that start a session.
 * @param {{ size: number, due: number, fresh: number, empty: string }} counts
 */
export function startSection({ size, due, fresh, empty }) {
  const n = (v) => v.toLocaleString("en");
  return `<p class="due">${
    size > 1
      ? `<b>${n(size)}</b> in this set · <b>${n(due)}</b> due for review · <b>${n(fresh)}</b> not seen yet`
      : esc(empty)
  }</p>
    <div class="go">
      <button class="btn primary" data-start${size < 2 ? " disabled" : ""}>Start drill</button>
      ${due ? `<button class="btn" data-start-due>Review the ${n(due)} due</button>` : ""}
      <button class="btn quiet" data-mode="explore">Back to the map</button>
    </div>`;
}

/**
 * One question, as the app describes it. Strings marked HTML must already be
 * escaped where they contain data.
 *
 * @typedef {object} Question
 * @property {string} main the question itself (HTML)
 * @property {string} [sub] a line under it (HTML)
 * @property {string} [hint] held back until asked for or answered (HTML)
 * @property {"click" | "choose" | "type"} answer how the learner answers
 * @property {{ label: string, correct: boolean }[]} [options] for "choose"
 * @property {string} answerText the right answer, as said in feedback (HTML)
 * @property {string} [aimNote] the instruction shown for "click"
 */

/**
 * @typedef {object} DrillHooks
 * @property {string} label the drill's name, shown in the bar
 * @property {(item: any) => string} keyOf the item's progress key
 * @property {(item: any) => Question} ask set the map up for the item and describe the question
 * @property {(item: any) => void} reveal show the answer on the map
 * @property {(text: string, item: any) => (import("./text.js").Verdict & { otherLabel?: string }) | null} [judge]
 *   judge a typed answer
 * @property {(item: any) => string} [rightNote] added after "Correct." for a typed answer (HTML)
 * @property {(item: any) => { label: string, look: string }} describe for the summary
 * @property {() => any[]} more items to carry on with when the session has no end
 */

export class DrillSession {
  /**
   * @param {object} options
   * @param {HTMLElement} options.bar the question bar
   * @param {HTMLElement} options.card where the end-of-session summary goes
   * @param {import("./leitner.js").ProgressStore} options.store
   * @param {() => boolean} options.isActive whether the drill is on screen (for keyboard shortcuts)
   * @param {(look: string) => void} options.onLook open an item's details
   * @param {() => void} options.onSetup back to the setup screen
   * @param {() => void} options.onEnd the session ended; the summary is about to show
   */
  constructor({ bar, card, store, isActive, onLook, onSetup, onEnd }) {
    this.bar = bar;
    this.card = card;
    this.store = store;
    this.isActive = isActive;
    this.onLook = onLook;
    this.onSetup = onSetup;
    this.onEnd = onEnd;
    /** @type {DrillHooks | null} */
    this.hooks = null;
    this.item = null;
    /** @type {Question | null} */
    this.question = null;
    this.reset([], 0);

    bar.addEventListener("click", (e) => this.onBarClick(e));
    card.addEventListener("click", (e) => {
      const look = e.target.closest("[data-look]");
      if (look && this.card.dataset.view === "summary") this.onLook(look.dataset.look);
      if (e.target.closest("[data-again]")) this.onSetup();
    });
    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  reset(queue, length) {
    this.queue = queue;
    this.length = length;
    this.at = 0;
    this.right = 0;
    this.done = 0;
    this.answered = false;
    this.hintOpen = false;
    this.alwaysHint = false;
    /** @type {{ ok: boolean, label: string, look: string }[]} */
    this.log = [];
    this.repeated = new Set();
  }

  /**
   * Start a session.
   * @param {any[]} queue the planned items, see shared/leitner.js planSession
   * @param {number} length questions in the session; 0 for no end
   * @param {DrillHooks} hooks
   * @param {{ alwaysHint?: boolean }} [options]
   */
  start(queue, length, hooks, { alwaysHint = false } = {}) {
    this.hooks = hooks;
    this.reset(queue, length);
    this.alwaysHint = alwaysHint;
    this.card.hidden = true;
    this.bar.hidden = false;
    this.next();
  }

  /** Stop without a summary, e.g. when the learner leaves the drill. */
  stop() {
    this.item = null;
    this.question = null;
    this.bar.hidden = true;
  }

  /** Whether a click on the map should be taken as an answer now. */
  get awaitingClick() {
    return Boolean(this.item) && !this.answered && this.question?.answer === "click";
  }

  /* ------------------------------------------------------------ flow */

  next() {
    if (this.length && this.at >= this.queue.length) return this.end();
    if (this.at >= this.queue.length) this.queue.push(...this.hooks.more());
    this.item = this.queue[this.at];
    this.answered = false;
    this.question = this.hooks.ask(this.item);
    this.hintOpen = this.alwaysHint && Boolean(this.question.hint);
    this.render();
  }

  /**
   * Record an answer and show the feedback.
   * @param {boolean} ok
   * @param {string} message HTML
   * @param {"ok" | "bad" | "near"} [tone] colour of the message; defaults from ok
   */
  finish(ok, message, tone) {
    const item = this.item;
    this.answered = true;
    this.done++;
    if (ok) this.right++;
    this.store.record(this.hooks.keyOf(item), ok);

    // Something missed comes back once more, a few questions later.
    if (!ok && !this.repeated.has(item) && this.queue.length < this.at + 40) {
      this.repeated.add(item);
      this.queue.splice(Math.min(this.queue.length, this.at + 4 + randomInt(3)), 0, item);
    }
    this.log.push({ ok, ...this.hooks.describe(item) });
    this.at++;

    // Once answered there is nothing left to give away.
    this.hintOpen = true;
    this.paintSub();
    this.bar.querySelector("[data-hint]")?.remove();

    const last = this.length && this.at >= this.queue.length;
    this.bar.querySelector(".qfoot").innerHTML =
      `<span class="msg ${tone ?? (ok ? "ok" : "bad")}">${message}</span>
      <button class="btn" data-look>Details</button>
      <button class="btn primary" data-next>${last ? "Finish" : "Next"}</button>`;
    this.bar.querySelector("[data-next]").focus({ preventScroll: true });
  }

  end() {
    this.stop();
    this.onEnd();
    const pct = this.done ? Math.round((this.right / this.done) * 100) : 0;
    const seen = new Set();
    const missed = this.log.filter((s) => !s.ok && !seen.has(s.look) && seen.add(s.look));
    this.card.dataset.view = "summary";
    this.card.innerHTML = `<h2>Session done</h2>
      <p class="lead">${this.right} of ${this.done} right — ${pct}%.</p>
      ${
        missed.length
          ? `<h3>Worth another look</h3><div class="pg-weak">${missed
              .slice(0, 24)
              .map((s) => `<button data-look="${esc(s.look)}">${esc(s.label)}</button>`)
              .join("")}</div>`
          : "<p>Nothing missed.</p>"
      }
      <div class="go end">
        <button class="btn primary" data-again>Another session</button>
        <button class="btn" data-mode="prog">See progress</button>
        <button class="btn quiet" data-mode="explore">Back to the map</button>
      </div>`;
    this.card.hidden = false;
  }

  /* --------------------------------------------------------- the bar */

  render() {
    const q = this.question;
    let body;
    if (q.answer === "click") {
      body = `<p class="aimnote">${q.aimNote ?? "Click where you think it is. Zoom in first if you want to be precise."}</p>`;
    } else if (q.answer === "type") {
      body = `<div class="typed"><input id="dIn" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type your answer"><button class="btn primary" data-check>Check</button></div>`;
    } else {
      body = `<div class="opts">${q.options
        .map((o, i) => `<button data-a="${i}"><kbd>${i + 1}</kbd>${esc(o.label)}</button>`)
        .join("")}</div>`;
    }
    const score = [
      this.done ? `${this.right} of ${this.done} right` : "",
      this.length
        ? `question ${Math.min(this.at + 1, this.queue.length)} of ${this.queue.length}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const skip =
      q.answer !== "choose" ? `<button class="btn quiet" data-skip>Show answer</button>` : "";
    const hint =
      q.hint && !this.hintOpen
        ? `<button class="btn quiet" data-hint>Hint: which country?</button>`
        : "";

    this.bar.innerHTML = `
      <div class="qtop">
        <button class="btn" data-setup>Change drill</button>
        <span>${esc(this.hooks.label)}</span>
        <span class="qscore">${score}</span>
      </div>
      <p class="qprompt">${q.main}<span class="sub">${this.subLine()}</span></p>
      ${body}
      <div class="qfoot">${skip}${hint}</div>`;

    if (q.answer === "type") {
      setTimeout(() => this.bar.querySelector("#dIn")?.focus({ preventScroll: true }), 40);
    }
  }

  subLine() {
    const q = this.question;
    const hint = this.hintOpen && q.hint ? `<span class="hintv">${q.hint}</span>` : "";
    return [q.sub, hint].filter(Boolean).join(" · ");
  }

  paintSub() {
    const sub = this.bar.querySelector(".qprompt .sub");
    if (sub && this.question) sub.innerHTML = this.subLine();
  }

  openHint() {
    if (!this.question?.hint || this.answered) return;
    this.hintOpen = true;
    this.bar.querySelector("[data-hint]")?.remove();
    this.paintSub();
  }

  /* --------------------------------------------------------- answers */

  choose(index) {
    if (this.answered || this.question.answer !== "choose") return;
    const options = this.question.options;
    const chosen = options[index];
    if (!chosen) return;
    this.bar.querySelectorAll("[data-a]").forEach((b) => {
      const o = options[Number(b.dataset.a)];
      if (o.correct) b.classList.add("right");
      else if (o === chosen) b.classList.add("wrong");
    });
    this.hooks.reveal(this.item);
    this.finish(
      chosen.correct,
      chosen.correct
        ? "Correct."
        : `That is ${esc(chosen.label)}. The answer is ${this.question.answerText}.`,
    );
  }

  check() {
    const input = this.bar.querySelector("#dIn");
    if (!input || this.answered) return;
    const verdict = this.hooks.judge(input.value, this.item);
    if (!verdict) {
      input.focus();
      return;
    }
    input.disabled = true;
    this.bar.querySelector("[data-check]")?.setAttribute("disabled", "");
    this.hooks.reveal(this.item);
    const want = this.question.answerText;
    if (verdict.ok) {
      const note = this.hooks.rightNote?.(this.item) ?? "";
      this.finish(true, (verdict.typo ? `Correct: ${want}.` : "Correct.") + note);
    } else {
      this.finish(
        false,
        verdict.otherLabel
          ? `That is ${esc(verdict.otherLabel)}. The answer is ${want}.`
          : `Not quite. The answer is ${want}.`,
      );
    }
  }

  skip() {
    if (this.answered) return;
    const input = this.bar.querySelector("#dIn");
    if (input) input.disabled = true;
    this.hooks.reveal(this.item);
    this.finish(false, `The answer is ${this.question.answerText}.`);
  }

  onBarClick(e) {
    const t = e.target;
    if (t.closest("[data-setup]")) return this.onSetup();
    if (t.closest("[data-next]")) return this.next();
    if (t.closest("[data-look]")) return this.onLook(this.hooks.describe(this.item).look);
    if (t.closest("[data-hint]")) return this.openHint();
    if (t.closest("[data-check]")) return this.check();
    if (t.closest("[data-skip]")) return this.skip();
    const a = t.closest("[data-a]");
    if (a) this.choose(Number(a.dataset.a));
  }

  onKey(e) {
    if (!this.isActive() || !this.item || document.querySelector("dialog[open]")) return;
    if (e.target.id === "dIn" && e.key === "Enter") {
      e.preventDefault();
      if (this.answered) this.next();
      else this.check();
      return;
    }
    if (e.target.matches("input, select, textarea")) return;
    if (!this.answered && (e.key === "h" || e.key === "H")) this.openHint();
    else if (!this.answered && /^[1-4]$/.test(e.key)) this.choose(Number(e.key) - 1);
    else if (this.answered && e.key === "Enter" && !e.target.closest("button")) {
      e.preventDefault();
      this.next();
    }
  }
}

/**
 * Up to `n` wrong options for multiple choice, drawn from the items nearest
 * to the right one, so the choice is between neighbours rather than between
 * places on different continents. Options are told apart by label: two
 * items with the same label never both appear.
 *
 * @template T
 * @param {T[]} candidates items that are not right answers
 * @param {(item: T) => number} distance from the right answer
 * @param {(item: T) => string} label
 * @param {Set<string>} taken labels already in use (the right answers)
 * @param {number} n
 * @returns {T[]}
 */
export function nearbyDistractors(candidates, distance, label, taken, n) {
  const seen = new Set(taken);
  const out = [];
  const sorted = candidates.map((o) => ({ o, d: distance(o) })).sort((a, b) => a.d - b.d);
  for (const { o } of sorted) {
    const l = label(o);
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(o);
    if (out.length >= n * 3) break;
  }
  return shuffle(out).slice(0, n);
}
