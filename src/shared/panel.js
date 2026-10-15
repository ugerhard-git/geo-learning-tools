/**
 * The detail panel that slides over the map with facts about a place.
 *
 * Details can be opened from inside a drill or from the progress screen.
 * That must not throw the learner's context away, so the caller can hand
 * over a function that puts the map back as it was; closing the panel then
 * runs it instead of the usual clean-up.
 *
 * @module shared/panel
 */

export class DetailPanel {
  /**
   * @param {HTMLElement} el
   * @param {object} [options]
   * @param {() => void} [options.onHide] whenever the panel closes: cancel pending requests
   * @param {() => void} [options.onDismiss] when it closes with nothing to return to:
   *   clear the selection on the map
   */
  constructor(el, { onHide = () => {}, onDismiss = () => {} } = {}) {
    this.el = el;
    this.onHide = onHide;
    this.onDismiss = onDismiss;
    /** @type {(() => void) | null} */
    this.returnTo = null;

    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) this.close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (!el.hidden) this.close();
    });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  /**
   * Show content. The HTML must already be escaped where it holds data.
   * A close button is added in front of it.
   * @param {string} html
   */
  show(html) {
    this.el.innerHTML = `<button class="close" aria-label="Close details" data-close>×</button>${html}`;
    this.el.hidden = false;
    this.el.scrollTop = 0;
  }

  /**
   * Show details over a drill or the progress screen; closing puts things back.
   * @param {() => void} returnTo
   */
  showOver(returnTo) {
    this.returnTo = returnTo;
    document.body.classList.add("withpanel");
  }

  close() {
    this.el.hidden = true;
    document.body.classList.remove("withpanel");
    this.onHide();
    const back = this.returnTo;
    this.returnTo = null;
    if (back) back();
    else this.onDismiss();
  }

  /** An element inside the panel, for filling in parts that load later. */
  part(selector) {
    return this.el.hidden ? null : this.el.querySelector(selector);
  }
}
