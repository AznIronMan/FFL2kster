/** On-screen controls for touch screens: a D-pad (sliding between directions, diagonals at the
 *  corners), A, B, Start and Select. Multi-touch: every active pointer is hit-tested against the
 *  buttons each time it moves, so the pad works like a real one. `buttons()` is read by the
 *  player once per frame and ORed with keyboard and gamepad input. */
import { BTN } from "@ffl2k/core";

export class TouchPad {
  readonly el: HTMLElement;
  private readonly pointers = new Map<number, number>();
  /** Buttons touched since the last read (a tap shorter than a frame still counts). */
  private pending = 0;
  private readonly pad: HTMLElement;

  constructor() {
    const b = (cls: string, label: string, bit: number) => {
      const e = document.createElement("div");
      e.className = `tbtn ${cls}`;
      e.dataset.bit = String(bit);
      e.textContent = label;
      return e;
    };
    this.pad = document.createElement("div");
    this.pad.className = "dpad";
    this.pad.append(b("up", "▲", BTN.UP), b("left", "◀", BTN.LEFT), b("right", "▶", BTN.RIGHT), b("down", "▼", BTN.DOWN));
    const ab = document.createElement("div");
    ab.className = "ab";
    ab.append(b("b", "B", BTN.B), b("a", "A", BTN.A));
    const mid = document.createElement("div");
    mid.className = "startsel";
    mid.append(b("select", "SELECT", BTN.SELECT), b("start", "START", BTN.START));
    this.el = document.createElement("div");
    this.el.className = "touchpad";
    this.el.append(this.pad, mid, ab);
    const update = (e: PointerEvent) => {
      e.preventDefault();
      const v = this.hit(e.clientX, e.clientY);
      this.pointers.set(e.pointerId, v);
      this.pending |= v;
      if (v && e.type === "pointerdown") navigator.vibrate?.(8);
      this.paint();
    };
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.paint();
    };
    this.el.addEventListener("pointerdown", (e) => { this.el.setPointerCapture(e.pointerId); update(e); });
    this.el.addEventListener("pointermove", (e) => { if (this.pointers.has(e.pointerId)) update(e); });
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Buttons under (x, y): a button element, or a direction (with diagonals) from the D-pad
   *  centre when the point is inside the pad's box. */
  private hit(x: number, y: number): number {
    const r = this.pad.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const dx = (x - (r.left + r.width / 2)) / (r.width / 2), dy = (y - (r.top + r.height / 2)) / (r.height / 2);
      if (Math.hypot(dx, dy) < 0.2) return 0;
      let v = 0;
      if (dx < -0.35) v |= BTN.LEFT;
      if (dx > 0.35) v |= BTN.RIGHT;
      if (dy < -0.35) v |= BTN.UP;
      if (dy > 0.35) v |= BTN.DOWN;
      return v;
    }
    const t = document.elementFromPoint(x, y) as HTMLElement | null;
    const bit = t?.closest<HTMLElement>(".tbtn")?.dataset.bit;
    return bit ? Number(bit) : 0;
  }

  private paint(): void {
    const v = this.held();
    for (const e of this.el.querySelectorAll<HTMLElement>(".tbtn")) e.classList.toggle("on", (v & Number(e.dataset.bit)) !== 0);
  }

  private held(): number {
    let v = 0;
    for (const b of this.pointers.values()) v |= b;
    return v;
  }

  /** Buttons for this frame: those held now and those tapped since the last call. */
  buttons(): number {
    const v = this.held() | this.pending;
    this.pending = 0;
    return v;
  }
}

/** Touch controls are shown by default on devices whose main pointer is coarse (phones,
 *  tablets) and inside the mobile shells; the player can toggle them anywhere. */
export function touchByDefault(): boolean {
  return matchMedia("(pointer: coarse)").matches;
}
