/**
 * A pannable, zoomable SVG world map: the visible window onto the projected
 * world, the mouse, touch and keyboard gestures that move it, and animated
 * moves to a place.
 *
 * The app draws into the SVG; this class only ever changes its viewBox. It
 * reports back through callbacks: `onChange` after every move (to keep
 * markers a constant size on screen), `onTap` for a click or tap that was
 * not a drag, and `onHover` for pointer movement with nothing pressed.
 *
 * @module shared/mapview
 */
import { prefersReducedMotion } from "./dom.js";
import { WORLD_W, projectBox } from "./projection.js";

/** How far a finger may wander and still count as a tap rather than a drag, in pixels. */
const TAP_SLOP = 5;

/** @typedef {import("./projection.js").Projection} Projection */
/** @typedef {[number, number, number, number]} Box [x, y, w, h] */

export class MapView {
  /**
   * @param {SVGSVGElement} svg
   * @param {object} options
   * @param {() => Projection} options.projection the projection currently drawn
   * @param {number} [options.minWidth] closest zoom, as map units across the screen
   * @param {() => { side: number, bottom: number }} [options.padding] pixels hidden
   *   behind panels on the right and at the bottom, which framing should avoid
   * @param {() => void} [options.onChange] after every change of view
   * @param {(target: Element, clientX: number, clientY: number) => void} [options.onTap]
   * @param {(event: PointerEvent) => void} [options.onHover]
   * @param {() => void} [options.onGestureStart] a drag or pinch has begun
   */
  constructor(svg, options) {
    this.svg = svg;
    this.projection = options.projection;
    this.minWidth = options.minWidth ?? 30;
    this.padding = options.padding ?? (() => ({ side: 0, bottom: 0 }));
    this.onChange = options.onChange ?? (() => {});
    this.onTap = options.onTap ?? (() => {});
    this.onHover = options.onHover ?? (() => {});
    this.onGestureStart = options.onGestureStart ?? (() => {});

    /** The visible window, in map units. */
    this.x = 0;
    this.y = 0;
    this.w = WORLD_W;
    this.h = WORLD_W / 2;
    /** The map's size on screen, in pixels. */
    this.cw = 1;
    this.ch = 1;
    this.anim = 0;

    this.bindPointer();
    this.bindWheelAndKeys();
    new ResizeObserver(() => this.keepScaleOnResize()).observe(svg);
  }

  /* ---------------------------------------------------------------- view */

  /** Re-read the map's size on screen. */
  measure() {
    const r = this.svg.getBoundingClientRect();
    this.cw = Math.max(1, r.width);
    this.ch = Math.max(1, r.height);
  }

  /** Map units per screen pixel at the current zoom. */
  unitsPerPixel() {
    return this.w / this.cw;
  }

  /** Zooming out stops once the whole world fits the screen, whatever its shape. */
  maxWidth() {
    return Math.max(WORLD_W * 1.1, (this.projection().home[3] * 1.05 * this.cw) / this.ch);
  }

  /**
   * Show the window whose top-left corner is (x, y) and which is w map units
   * wide. The zoom is kept within limits and the centre within the world.
   */
  set(x, y, w) {
    w = Math.min(this.maxWidth(), Math.max(this.minWidth, w));
    const h = (w * this.ch) / this.cw;
    const [ex, ey, ew, eh] = this.projection().extent;
    const cx = Math.min(ex + ew, Math.max(ex, x + w / 2));
    const cy = Math.min(ey + eh, Math.max(ey, y + h / 2));
    this.w = w;
    this.h = h;
    this.x = cx - w / 2;
    this.y = cy - h / 2;
    this.svg.setAttribute("viewBox", `${this.x} ${this.y} ${this.w} ${this.h}`);
    this.onChange();
  }

  /** Show the whole world. */
  home() {
    this.measure();
    const [hx, hy, hw, hh] = this.projection().home;
    const w = Math.max(hw * 1.02, (hh * 1.02 * this.cw) / this.ch);
    this.set(hx + hw / 2 - w / 2, hy + hh / 2 - (w * this.ch) / this.cw / 2, w);
  }

  /** Screen coordinates to map units. */
  toMap(clientX, clientY) {
    const r = this.svg.getBoundingClientRect();
    return [
      this.x + ((clientX - r.left) / this.cw) * this.w,
      this.y + ((clientY - r.top) / this.ch) * this.h,
    ];
  }

  /** Screen coordinates to longitude/latitude. */
  toLonLat(clientX, clientY) {
    return this.projection().inv(...this.toMap(clientX, clientY));
  }

  /** Zoom by factor `f` about a point in map units, which stays where it is on screen. */
  zoomAt(mx, my, f) {
    const w = Math.min(this.maxWidth(), Math.max(this.minWidth, this.w / f));
    const k = w / this.w;
    this.set(mx - (mx - this.x) * k, my - (my - this.y) * k, w);
  }

  /** The current window, to put back later with {@link restore}. */
  snapshot() {
    return { x: this.x, y: this.y, w: this.w };
  }

  restore({ x, y, w }) {
    this.stop();
    this.set(x, y, w);
  }

  /** The longitude/latitude at the centre of the screen. */
  centreLonLat() {
    return this.projection().inv(this.x + this.w / 2, this.y + this.h / 2);
  }

  /** Centre on a longitude/latitude without changing zoom (after a projection switch). */
  centreAt(lon, lat) {
    const [x, y] = this.projection().fwd(lon, lat);
    this.set(x - this.w / 2, y - this.h / 2, this.w);
  }

  /* ---------------------------------------------------------- animation */

  /** Stop any move in progress. */
  stop() {
    cancelAnimationFrame(this.anim);
  }

  /**
   * Glide to a new centre and width. Zoom eases on a log scale, so zooming
   * a long way in or out feels steady rather than sudden at one end.
   */
  flyTo(cx, cy, w) {
    this.stop();
    w = Math.min(this.maxWidth(), Math.max(this.minWidth, w));
    const ratio = () => this.ch / this.cw;
    if (prefersReducedMotion()) {
      this.set(cx - w / 2, cy - (w * ratio()) / 2, w);
      return;
    }
    const from = { cx: this.x + this.w / 2, cy: this.y + this.h / 2, w: this.w };
    const start = performance.now();
    const step = (now) => {
      const u = Math.min(1, (now - start) / 640);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      const ww = Math.exp(Math.log(from.w) + (Math.log(w) - Math.log(from.w)) * e);
      const x = from.cx + (cx - from.cx) * e;
      const y = from.cy + (cy - from.cy) * e;
      this.set(x - ww / 2, y - (ww * ratio()) / 2, ww);
      if (u < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  /**
   * Glide to frame a box given in map units, with `factor` as breathing room
   * around it, never closer than `minSpan` map units across. Panels covering
   * part of the map are allowed for, so the box lands in the part still
   * visible.
   * @param {Box | null} box
   */
  frame(box, factor = 1.8, minSpan = 260) {
    if (!box) return;
    const [bx, by, bw, bh] = box;
    const { side, bottom } = this.padding();
    const span = Math.max(
      (bw * factor * this.cw) / Math.max(200, this.cw - side),
      (bh * factor * this.cw) / Math.max(160, this.ch - bottom),
      minSpan,
    );
    const k = span / this.cw;
    this.flyTo(bx + bw / 2 + (side / 2) * k, by + bh / 2 + (bottom / 2) * k, span);
  }

  /** Like {@link frame}, for a box in degrees: [lon, lat, width, height]. */
  frameLonLat(box, factor, minSpan) {
    if (box) this.frame(projectBox(this.projection(), box), factor, minSpan);
  }

  /** Glide to a longitude/latitude, `span` map units across. */
  centreOn(lon, lat, span) {
    const [x, y] = this.projection().fwd(lon, lat);
    const { side, bottom } = this.padding();
    const k = span / this.cw;
    this.flyTo(x + (side / 2) * k, y + (bottom / 2) * k, span);
  }

  /* ----------------------------------------------------------- gestures */

  /*
   * Drag to pan, pinch to zoom, tap to pick.
   *
   * Whenever the number of fingers changes, the gesture is re-anchored to
   * where the fingers are now and to the view as it stands. Carrying an old
   * anchor across that moment is what makes a map leap: lift one finger of a
   * pinch and the pan would otherwise still be measured from the other
   * finger's first touch, against the width the view had before the zoom.
   */
  bindPointer() {
    const svg = this.svg;
    /** @type {Map<number, { x: number, y: number }>} */
    const pointers = new Map();
    let gesture = null; // { mode: "pan", x, y, vx, vy } or { mode: "pinch", d, cx, cy }
    let tap = null; // a single pointer that has not moved far enough to be a drag

    const anchor = () => {
      const pts = [...pointers.values()];
      if (!pts.length) {
        gesture = null;
      } else if (pts.length === 1) {
        gesture = { mode: "pan", x: pts[0].x, y: pts[0].y, vx: this.x, vy: this.y };
      } else {
        const [a, b] = pts;
        gesture = {
          mode: "pinch",
          d: Math.hypot(a.x - b.x, a.y - b.y),
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        };
      }
    };

    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button > 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.stop();
      // Two fingers down is never a tap.
      tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, target: e.target } : null;
      if (pointers.size > 1) {
        svg.classList.add("dragging");
        this.onGestureStart();
      }
      anchor();
    });

    window.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) {
        if (e.target instanceof Element && svg.contains(e.target)) this.onHover(e);
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) return;
      if (tap) {
        if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= TAP_SLOP) return;
        tap = null;
        svg.classList.add("dragging");
        this.onGestureStart();
      }
      if (gesture.mode === "pan") {
        this.set(
          gesture.vx - ((e.clientX - gesture.x) / this.cw) * this.w,
          gesture.vy - ((e.clientY - gesture.y) / this.ch) * this.h,
          this.w,
        );
        return;
      }
      const pts = [...pointers.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      // The map holds on to the point that was between the fingers, and
      // follows the fingers as they travel.
      const [mx, my] = this.toMap(gesture.cx, gesture.cy);
      const scaled = d > 0 && gesture.d > 0 ? (this.w * gesture.d) / d : this.w;
      const w = Math.min(this.maxWidth(), Math.max(this.minWidth, scaled));
      const r = svg.getBoundingClientRect();
      this.set(
        mx - ((cx - r.left) / this.cw) * w,
        my - ((cy - r.top) / this.ch) * ((w * this.ch) / this.cw),
        w,
      );
      Object.assign(gesture, { d, cx, cy });
    });

    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        if (tap && e.type === "pointerup") this.onTap(tap.target, tap.x, tap.y);
        tap = null;
        gesture = null;
        svg.classList.remove("dragging");
        return;
      }
      anchor(); // carry on from where the fingers are now
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);

    /** Whether a drag or pinch is under way, for hover handlers to stand aside. */
    this.isGesturing = () => Boolean(gesture) && !tap;
  }

  bindWheelAndKeys() {
    this.svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.stop();
        // Lines and pages are converted to rough pixel equivalents.
        const dy =
          e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        const [mx, my] = this.toMap(e.clientX, e.clientY);
        this.zoomAt(mx, my, Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0022));
      },
      { passive: false },
    );

    this.svg.addEventListener("keydown", (e) => {
      const step = this.w * 0.1;
      const cx = this.x + this.w / 2;
      const cy = this.y + this.h / 2;
      const move = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }[e.key];
      if (move) {
        e.preventDefault();
        this.set(this.x + move[0], this.y + move[1], this.w);
      }
      if (e.key === "+" || e.key === "=") this.zoomAt(cx, cy, 1.5);
      if (e.key === "-" || e.key === "_") this.zoomAt(cx, cy, 1 / 1.5);
    });
  }

  /** Wire the on-screen zoom buttons. */
  bindZoomButtons(zoomIn, zoomOut, home) {
    const centre = () => [this.x + this.w / 2, this.y + this.h / 2];
    zoomIn.addEventListener("click", () => this.zoomAt(...centre(), 1.8));
    zoomOut.addEventListener("click", () => this.zoomAt(...centre(), 1 / 1.8));
    home.addEventListener("click", () => this.home());
  }

  /** Keep the same centre and scale when the map changes size on screen. */
  keepScaleOnResize() {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const scale = this.w / this.cw;
    this.measure();
    const w = scale * this.cw;
    this.set(cx - w / 2, cy - (w * this.ch) / this.cw / 2, w);
  }
}
