/** The game player: runs the engine at the Game Boy's 59.73 Hz, draws the PPU frame on a canvas,
 *  plays the sound driver through the APU model (audio.ts; starts on the first key/click/touch,
 *  'M' mutes) and maps keyboard, gamepad and touch input. Battery RAM (saves) is persisted in
 *  IndexedDB. While the page or app is hidden the game pauses (mobile lifecycle). */
import { Engine, NotPorted, SoftReset, BTN } from "@ffl2k/core";
import { Ppu, regsFromIo, SCREEN_W, SCREEN_H } from "@ffl2k/render";
import type { DataPackage } from "@ffl2k/importer";
import { loadSram, saveSram } from "./storage";
import { AudioOut } from "./audio";

const FRAME_MS = 1000 / 59.7275;
/** Minimum frames a key press is held for the game (taps are stretched to this). */
const MIN_PRESS = 4;
/** DMG-like greens are an optional extra; default is the plain 4 greys. */
const PALETTE = [[0xff, 0xff, 0xff], [0xaa, 0xaa, 0xaa], [0x55, 0x55, 0x55], [0x00, 0x00, 0x00]];

const KEYS: Record<string, number> = {
  ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT,
  KeyZ: BTN.A, KeyX: BTN.B, Enter: BTN.START, ShiftRight: BTN.SELECT, ShiftLeft: BTN.SELECT, Backspace: BTN.SELECT,
};

export interface PlayerUi {
  canvas: HTMLCanvasElement;
  onStatus(msg: string): void;
  /** Extra button sources read once per frame (e.g. the touch pad), ORed with keys and pads. */
  inputs?: (() => number)[];
}

export class Player {
  private engine!: Engine;
  private ppu!: Ppu;
  private running = false;
  private last = 0;
  private acc = 0;
  /** Keys down now, and keys pressed since the last frame (a tap shorter than a frame counts). */
  private keys = 0;
  private taps = 0;
  /** Buttons seen last frame (all sources) and the frame each one was pressed. */
  private prev = 0;
  private readonly pressedAt = new Map<number, number>();
  private paused = false;
  private img: ImageData;
  private ctx: CanvasRenderingContext2D;
  private sramDirty = false;
  private lastSram = new Uint8Array(0x2000);
  private readonly audio = new AudioOut();

  constructor(readonly pkg: DataPackage, readonly ui: PlayerUi) {
    ui.canvas.width = SCREEN_W;
    ui.canvas.height = SCREEN_H;
    this.ctx = ui.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    const gesture = () => void this.audio.start();
    window.addEventListener("keydown", gesture, { once: true });
    window.addEventListener("pointerdown", gesture, { once: true });
    window.addEventListener("touchend", gesture, { once: true });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyM" || e.repeat) return;
      const muted = this.audio.toggleMute();
      if (this.running) this.ui.onStatus(muted ? "Sound muted (M)" : "Sound on (M)");
    });
    window.addEventListener("keydown", (e) => this.key(e, true));
    window.addEventListener("keyup", (e) => this.key(e, false));
    document.addEventListener("visibilitychange", () => this.setPaused(document.hidden));
    window.addEventListener("pagehide", () => void this.persist());
  }

  /** The ROM image the engine reads data from, rebuilt from the package's bank segments. */
  private romBytes(): Uint8Array {
    const n = Object.keys(this.pkg.segments).length;
    const rom = new Uint8Array(n * 0x4000);
    for (const [k, v] of Object.entries(this.pkg.segments)) rom.set(v, parseInt(k, 16) * 0x4000);
    return rom;
  }

  async start(): Promise<void> {
    this.engine = new Engine(this.pkg.segments, this.romBytes());
    this.audio.attach(this.engine.g);
    const m = this.engine.g.m;
    const sram = await loadSram().catch(() => undefined);
    if (sram) {
      m.sram.set(sram);
      this.lastSram.set(sram);
    }
    this.ppu = new Ppu(m.vram, m.oam);
    this.engine.g.onLine = (y) => {
      if (y === 0) this.ppu.beginFrame();
      this.ppu.regs = regsFromIo(m.io);
      this.ppu.line(y);
    };
    this.engine.g.start(this.engine.main());
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const b = KEYS[e.code];
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
   *  so a tap shorter than a frame (or than the game's joypad edge detection) is not lost. */
  private sample(): number {
    const f = this.engine.g.frame;
    let raw = this.keys | this.taps | gamepads();
    this.taps = 0;
    for (const src of this.ui.inputs ?? []) raw |= src();
    for (let b = 1; b < 0x100; b <<= 1) if (raw & b && !(this.prev & b)) this.pressedAt.set(b, f);
    this.prev = raw;
    let v = raw;
    for (const [b, at] of this.pressedAt) if (f - at < MIN_PRESS) v |= b;
    return v;
  }

  private tick(now: number): void {
    if (!this.running || this.paused) return;
    this.acc += Math.min(now - this.last, 250);
    this.last = now;
    let n = 0;
    while (this.acc >= FRAME_MS && n < 4) {
      this.acc -= FRAME_MS;
      n++;
      this.engine.g.buttons = this.sample();
      try {
        this.engine.g.runFrame();
        this.audio.endFrame(this.engine.g.frame);
      } catch (e) {
        this.audio.endFrame(this.engine.g.frame);
        if (e instanceof SoftReset) {
          void this.persist();
          this.engine.g.start(this.engine.main());
          continue;
        }
        this.running = false;
        this.ui.onStatus(e instanceof NotPorted ? `${e.message} — this part of the game is not available in this build yet.` : `Engine error: ${(e as Error).message}`);
        console.error(e);
        void this.persist();
        return;
      }
    }
    if (n) this.draw();
    this.checkSram();
    requestAnimationFrame((t) => this.tick(t));
  }

  private draw(): void {
    const f = this.ppu.frame, d = this.img.data;
    for (let i = 0; i < f.length; i++) {
      const c = PALETTE[f[i]!]!;
      d[4 * i] = c[0]!; d[4 * i + 1] = c[1]!; d[4 * i + 2] = c[2]!; d[4 * i + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
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
    await saveSram(this.engine.g.m.sram.slice());
  }
}

/** Every connected gamepad (any can play). The "standard" mapping (Chrome, Edge, Safari, Firefox,
 *  the Android and iOS web views): south face button A, east B, back/view Select, start/menu
 *  Start, D-pad 12-15, left stick with a dead zone. Pads without that mapping use the same
 *  indexes, which most report anyway. */
export function gamepads(): number {
  let v = 0;
  for (const p of navigator.getGamepads?.() ?? []) {
    if (!p || !p.connected) continue;
    const btn = (i: number) => p.buttons[i]?.pressed;
    const x = p.axes[0] ?? 0, y = p.axes[1] ?? 0;
    if (btn(0)) v |= BTN.A;
    if (btn(1)) v |= BTN.B;
    if (btn(8)) v |= BTN.SELECT;
    if (btn(9)) v |= BTN.START;
    if (btn(12) || y < -0.5) v |= BTN.UP;
    if (btn(13) || y > 0.5) v |= BTN.DOWN;
    if (btn(14) || x < -0.5) v |= BTN.LEFT;
    if (btn(15) || x > 0.5) v |= BTN.RIGHT;
  }
  return v;
}
