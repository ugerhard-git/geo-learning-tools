/**
 * Small DOM and formatting helpers used by every page.
 * @module shared/dom
 */

/** The first element matching a CSS selector, or null. */
export const $ = (selector, root = document) => root.querySelector(selector);

/** Every element matching a CSS selector, as an array. */
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escape text for interpolation into HTML, as element content or inside a
 * quoted attribute value.
 *
 * Rule of thumb for the whole codebase: anything that did not come from this
 * repository's own source — data files, what the learner types, anything
 * fetched from another site — passes through `esc` before it reaches
 * `innerHTML`.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/**
 * A lookup table with no prototype.
 *
 * Plain object literals inherit from Object.prototype, so `obj["__proto__"]`
 * or `obj["constructor"]` is truthy for any object. When the key comes from
 * storage or user input, that lets a junk value pass a check like
 * `if (DRILLS[saved])`. A table only answers for the keys it was given.
 *
 * @template T
 * @param {Record<string, T>} entries
 * @returns {Record<string, T>}
 */
export const table = (entries) => Object.assign(Object.create(null), entries);

const NUMBER = new Intl.NumberFormat("en");

/** Format a number with thousands separators. `null` and `undefined` become "". */
export const fmtNum = (n) => (n == null ? "" : NUMBER.format(n));

/** Whether the viewer has asked the system for reduced motion. */
export const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
