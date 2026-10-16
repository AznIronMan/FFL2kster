/** The game player: runs the engine at the Game Boy's 59.73 Hz, draws the PPU frame on a canvas,
 *  plays the sound driver through the APU model (audio.ts; starts on the first key/click/touch,
 *  'M' mutes) and maps keyboard, gamepad and touch input (rebindable, settings.ts). Battery RAM
 *  (saves) is persisted in IndexedDB. While the page or app is hidden the game pauses.
 *  P5 extras, all opt-in: fast text and cap break (engine options), battle speed, fast-forward
 *  (hold Tab / right shoulder), auto-battle, palettes, reduced flashing. */
import { Engine, NotPorted, SoftReset, BTN } from "@ffl2k/core";
import { Ppu, regsFromIo, SCREEN_W, SCREEN_H } from "@ffl2k/render";
import type { DataPackage } from "@ffl2k/importer";
import { loadSram, saveSram, saveSramBackup } from "./storage";
import { AudioOut } from "./audio";
import { settings, onSettings, update, PALETTES, FAST_FORWARD_KEY, FAST_FORWARD_PAD, type Settings } from "./settings";
import { WideView } from "./wide";

const FRAME_MS = 1000 / 59.7275;
/** Minimum frames a key press is held for the game (taps are stretched to this). */
const MIN_PRESS = 4;
/** Most engine frames run per display frame (catch-up after a stall × speed). */
const MAX_STEPS = 16;

export interface PlayerUi {
  canvas: HTMLCanvasElement;
  onStatus(msg: string): void;
  /** The engine stopped with an error: show it (details for a bug report). */
  onError?(message: string, details: string): void;
  /** Extra button sources read once per frame (e.g. the touch pad), ORed with keys and pads. */
  inputs?: (() => number)[];
}

export class Player {
  engine!: Engine;
  private ppu!: Ppu;
  private running = false;
  private last = 0;
  private acc = 0;
  /** Keys down now, and keys pressed since the last frame (a tap shorter than a frame counts). */
  private keys = 0;
  private taps = 0;
  private ffKey = false;
  /** Buttons seen last frame (all sources) and the frame each one was pressed. */
  private prev = 0;
  private readonly pressedAt = new Map<number, number>();
  private paused = false;
  private img: ImageData;
  private ctx: CanvasRenderingContext2D;
  private sramDirty = false;
  private lastSram = new Uint8Array(0x2000);
  private readonly audio = new AudioOut();
  private s: Settings = settings();
  /** Reduced flashing: the colours last shown, per pixel (RGB). */
  private shown: Float32Array | null = null;
  private wide: WideView | null = null;
  private lastBadge = "";
  /** The save at the start of this session, kept as the backup on the session's first write. */
  private sessionStart: Uint8Array | null = null;

  constructor(readonly pkg: DataPackage, readonly ui: PlayerUi) {
    this.ctx = ui.canvas.getContext("2d")!;
    this.img = this.resize(SCREEN_W);
    // The player is made in the Play click (a user gesture): start the sound now, so the title
    // music is heard; where the browser still holds it back, the next key or tap starts it.
    void this.audio.start();
    const gesture = () => void this.audio.start();
    window.addEventListener("keydown", gesture, { once: true });
    window.addEventListener("pointerdown", gesture, { once: true });
    window.addEventListener("touchend", gesture, { once: true });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyM" || e.repeat || isTyping(e)) return;
      this.toggleMute();
    });
    window.addEventListener("keydown", () => this.audio.wake());
    window.addEventListener("pointerdown", () => this.audio.wake());
    window.addEventListener("keydown", (e) => this.key(e, true));
    window.addEventListener("keyup", (e) => this.key(e, false));
    document.addEventListener("visibilitychange", () => this.setPaused(document.hidden));
    window.addEventListener("pagehide", () => void this.persist());
    onSettings((s) => this.apply(s));
  }

  private resize(w: number): ImageData {
    this.ui.canvas.width = w;
    this.ui.canvas.style.setProperty("--ar", String(w / SCREEN_H));
    this.ui.canvas.height = SCREEN_H;
    this.shown = null;
    return this.ctx.createImageData(w, SCREEN_H);
  }

  /** Mute or unmute (M key, Sound button); remembered on this device. */
  toggleMute(): boolean {
    const muted = !settings().muted;
    update({ muted });
    if (this.running) this.ui.onStatus(muted ? "Sound muted (M)" : "Sound on (M)");
    return muted;
  }

  /** Apply settings (live): engine options, widescreen, sound. */
  private apply(s: Settings): void {
    this.s = s;
    if (!this.engine) return;
    this.engine.setOptions({ fastText: s.fastText, capBreak: s.capBreak });
    this.audio.setLatency(s.audioLatency);
    this.audio.setMuted(s.muted);
    if (s.widescreen && !this.wide) {
      this.wide = new WideView(this.engine);
      this.img = this.resize(this.wide.width);
    } else if (!s.widescreen && this.wide) {
      this.wide = null;
      this.img = this.resize(SCREEN_W);
    }
  }

  /** The ROM image the engine reads data from, rebuilt from the package's bank segments. */
  private romBytes(): Uint8Array {
    const n = Object.keys(this.pkg.segments).length;
    const rom = new Uint8Array(n * 0x4000);
    for (const [k, v] of Object.entries(this.pkg.segments)) rom.set(v, parseInt(k, 16) * 0x4000);
    return rom;
  }

  async start(): Promise<void> {
    // a private copy of the segments: options may patch bytecode in memory (cap break)
    const segs = Object.fromEntries(Object.entries(this.pkg.segments).map(([k, v]) => [k, v.slice()]));
    this.engine = new Engine(segs, this.romBytes());
    this.audio.attach(this.engine.g);
    const m = this.engine.g.m;
    const sram = await loadSram().catch(() => undefined);
    if (sram) {
      m.sram.set(sram);
      this.lastSram.set(sram);
      this.sessionStart = sram.slice();
    }
    this.ppu = new Ppu(m.vram, m.oam);
    this.engine.g.onLine = (y) => {
      if (y === 0) this.ppu.beginFrame();
      this.ppu.regs = regsFromIo(m.io);
      this.ppu.line(y);
      this.wide?.line(y);
    };
    this.apply(this.s);
    this.engine.g.start(this.engine.main());
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (isTyping(e)) return;
    if (e.code === FAST_FORWARD_KEY) {
      e.preventDefault();
      this.ffKey = down;
      return;
    }
    const b = this.s.keys[e.code];
    if (b === undefined) return;
    e.preventDefault();
    if (down) {
      this.keys |= b;
      this.taps |= b;
    } else this.keys &= ~b;
  }

  /** Pause while hidden (the game does not run in the background); persist saves first. */
  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    if (p) {
      void this.persist();
      void this.audio.suspend();
    } else {
      void this.audio.resume();
      this.last = performance.now();
      this.acc = 0;
      if (this.running) requestAnimationFrame((t) => this.tick(t));
    }
  }

  /** This frame's buttons from every source. A new press is held for at least MIN_PRESS frames,
   *  so a tap shorter than a frame (or than the game's joypad edge detection) is not lost.
   *  Auto-battle presses A (2 frames on, 4 off) while the battle command menus wait. */
  private sample(): number {
    const g = this.engine.g, f = g.frame;
    let raw = this.keys | this.taps | gamepads(this.s.pad);
    this.taps = 0;
    for (const src of this.ui.inputs ?? []) raw |= src();
    if (this.s.autoBattle && g.ui.battleCommand && f % 6 < 2) raw |= BTN.A;
    for (let b = 1; b < 0x100; b <<= 1) if (raw & b && !(this.prev & b)) this.pressedAt.set(b, f);
    this.prev = raw;
    let v = raw;
    for (const [b, at] of this.pressedAt) if (f - at < MIN_PRESS) v |= b;
    return v;
  }

  /** Engine frames per display frame: fast-forward while held, the battle speed in battle
   *  (FF8B = FF), else 1. Speed changes only how fast frames are shown, never what they do. */
  private speed(): number {
    if (this.ffKey || padButton(FAST_FORWARD_PAD)) return this.s.fastForward;
    if (this.engine.g.m.hram[0x0b] === 0xff) return this.s.battleSpeed;
    return 1;
  }

  private tick(now: number): void {
    if (!this.running || this.paused) return;
    this.acc += Math.min(now - this.last, 250);
    this.last = now;
    const sp = this.speed();
    let n = 0;
    while (this.acc >= FRAME_MS && n < MAX_STEPS) {
      this.acc -= FRAME_MS;
      for (let k = 0; k < sp && n < MAX_STEPS; k++) {
        n++;
        this.engine.g.buttons = this.sample();
        try {
          this.engine.g.runFrame();
          this.audio.endFrame(this.engine.g.frame, sp);
        } catch (e) {
          this.audio.endFrame(this.engine.g.frame, sp);
          if (e instanceof SoftReset) {
            void this.persist();
            if (this.wide) this.wide = new WideView(this.engine);
            this.engine.g.start(this.engine.main());
            continue;
          }
          this.running = false;
          const msg = e instanceof NotPorted ? `${e.message} — this part of the game is not available in this build yet.` : `Engine error: ${(e as Error).message}`;
          this.ui.onStatus(msg);
          this.ui.onError?.(msg, this.details(e as Error));
          console.error(e);
          void this.persist();
          return;
        }
      }
    }
    if (n) this.draw();
    const badge = [sp > 1 ? `▶▶ ×${sp}` : "", this.s.autoBattle && this.engine.g.m.hram[0x0b] === 0xff ? "AUTO" : ""].filter(Boolean).join("  ");
    if (badge !== this.lastBadge) { this.lastBadge = badge; this.ui.onStatus(badge); }
    this.checkSram();
    requestAnimationFrame((t) => this.tick(t));
  }

  private draw(): void {
    const pal = PALETTES[this.s.palette].rgb;
    const w = this.img.width;
    const f = this.wide ? this.wide.compose(this.ppu.frame) : this.ppu.frame;
    const d = this.img.data;
    const n = w * SCREEN_H;
    if (!this.s.reduceFlash) {
      this.shown = null;
      for (let i = 0; i < n; i++) {
        const c = pal[f[i]!]!;
        d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2]; d[4 * i + 3] = 255;
      }
    } else this.drawLimited(f, pal, n);
    this.ctx.putImageData(this.img, 0, 0);
  }

  /** Reduced flashing (accessibility): when most of the screen changes brightness sharply from
   *  one frame to the next (battle flashes, palette blinks), each pixel moves at most 1/4 of
   *  the way per frame, so flashes become gentle fades. Ordinary motion is untouched. */
  private drawLimited(f: Uint8Array, pal: [number, number, number][], n: number): void {
    const d = this.img.data;
    if (!this.shown || this.shown.length !== n * 3) {
      this.shown = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const c = pal[f[i]!]!; this.shown.set(c, 3 * i); }
    }
    const sh = this.shown;
    let big = 0;
    for (let i = 0; i < n; i++) {
      const c = pal[f[i]!]!;
      if (Math.abs(c[0] + c[1] + c[2] - sh[3 * i]! - sh[3 * i + 1]! - sh[3 * i + 2]!) > 300) big++;
    }
    const flash = big > n / 3;
    for (let i = 0; i < n; i++) {
      const c = pal[f[i]!]!;
      for (let k = 0; k < 3; k++) {
        const v = flash ? sh[3 * i + k]! + (c[k]! - sh[3 * i + k]!) * 0.25 : c[k]!;
        sh[3 * i + k] = v;
        d[4 * i + k] = v;
      }
      d[4 * i + 3] = 255;
    }
  }

  private checkSram(): void {
    const s = this.engine.g.m.sram;
    for (let i = 0; i < s.length; i += 64) {
      let same = true;
      for (let k = i; k < i + 64; k++) if (s[k] !== this.lastSram[k]) { same = false; break; }
      if (!same) {
        this.sramDirty = true;
        this.lastSram.set(s);
        void this.persist();
        return;
      }
    }
  }

  async persist(): Promise<void> {
    if (!this.sramDirty || !this.engine) return;
    this.sramDirty = false;
    if (this.sessionStart) {
      const b = this.sessionStart;
      this.sessionStart = null;
      await saveSramBackup(b).catch(() => {});
    }
    await saveSram(this.engine.g.m.sram.slice());
  }

  /** Text for a bug report: the error, where the game was, and the build. No save or ROM data. */
  private details(e: Error): string {
    const m = this.engine.g.m;
    const hx = (v: number, n = 2) => v.toString(16).padStart(n, "0");
    return [
      `FFTOL ${__APP_VERSION__} on ${navigator.userAgent}`,
      `ROM ${this.pkg.sourceSha256.slice(0, 16)}${this.pkg.verified === false ? " (unverified)" : ""}${this.pkg.mods?.length ? ` mods: ${this.pkg.mods.join(", ")}` : ""}`,
      `frame ${this.engine.g.frame}, bank ${hx(m.bank)}, tileset ${hx(m.rd(0xc450))}, view cell ${m.rd(0xc42c)},${m.rd(0xc42d)}, battle ${m.hram[0x0b] === 0xff}`,
      `options ${JSON.stringify(this.engine.g.options)}`,
      `${e.name}: ${e.message}`,
      e.stack ?? "",
    ].join("\n");
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
}

function padButton(i: number): boolean {
  for (const p of navigator.getGamepads?.() ?? []) if (p?.connected && p.buttons[i]?.pressed) return true;
  return false;
}

/** Every connected gamepad (any can play), through the button map (default: the W3C "standard"
 *  mapping, which Xbox, PlayStation and Switch Pro controllers report; Game Boy layout by
 *  default: east face button = A, south = B, back/view = Select, start/menu = Start, D-pad
 *  12-15). The left stick always moves (dead zone 0.5). */
export function gamepads(map: Record<number, number>): number {
  let v = 0;
  for (const p of navigator.getGamepads?.() ?? []) {
    if (!p || !p.connected) continue;
    for (const [i, b] of Object.entries(map)) if (p.buttons[Number(i)]?.pressed) v |= b;
    const x = p.axes[0] ?? 0, y = p.axes[1] ?? 0;
    if (y < -0.5) v |= BTN.UP;
    if (y > 0.5) v |= BTN.DOWN;
    if (x < -0.5) v |= BTN.LEFT;
    if (x > 0.5) v |= BTN.RIGHT;
  }
  return v;
}
