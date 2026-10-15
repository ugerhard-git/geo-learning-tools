/**
 * Flag images from flagcdn.com.
 *
 * Flags are the one part of the pages that needs a connection to another
 * site at all times; if it cannot be reached, each flag simply drops out of
 * the layout rather than leaving a broken-image icon.
 *
 * @module shared/flags
 */
import { esc } from "./dom.js";

/** A two-letter code flagcdn knows, or a sub-national one like "gb-sct". */
const CODE = /^[A-Za-z]{2}(-[A-Za-z]{2,3})?$/;

/**
 * The address of a flag image.
 * @param {string} code ISO 3166 code, e.g. "DE" or "GB-SCT"
 * @param {"w" | "h"} axis fix the width or the height
 * @param {number} px one of flagcdn's sizes, e.g. w320 or h40
 * @returns {string} "" for a code flagcdn would not know
 */
export function flagUrl(code, axis, px) {
  if (!CODE.test(code ?? "")) return "";
  return `https://flagcdn.com/${axis}${px}/${code.toLowerCase()}.png`;
}

/** The address of a flag as SVG, for large flags that must stay sharp. */
export const flagSvgUrl = (code) =>
  CODE.test(code ?? "") ? `https://flagcdn.com/${code.toLowerCase()}.svg` : "";

/**
 * HTML for a small flag beside a country's name, at 1× and 2× resolution.
 * @param {string} code
 * @param {string} name used for the alt text
 */
export function flagMini(code, name) {
  if (!/^[A-Z]{2}$/.test(code ?? "")) return "";
  return `<img class="flagmini" loading="lazy" alt="Flag of ${esc(name || code)}"
    src="${flagUrl(code, "h", 40)}" srcset="${flagUrl(code, "h", 80)} 2x">`;
}

/**
 * Hide any flag image that fails to load. The Content-Security-Policy rules
 * out inline onerror="" handlers, so one listener on the document does it
 * for every flag. Image errors do not bubble, but they can be caught on the
 * way down (the capture phase), which also covers flags added later.
 *
 * @param {string} [selector] which images count as flags
 */
export function hideFailedFlags(selector = "img.flagmini, img[data-flag]") {
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.matches(selector)) {
        img.classList.add("flag-failed");
      }
    },
    true,
  );
}
