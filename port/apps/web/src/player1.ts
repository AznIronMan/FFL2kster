/** The Legend I player (FFL1kster): the @ffl1k/core engine from the start code (00:0224) at the
 *  Game Boy's 59.73 Hz, the PPU frame on a canvas, keyboard / gamepad / touch input through the
 *  same bindings as Legend II, and the MBC2 battery RAM (512 nibbles) persisted in IndexedDB.
 *  Sound: the Legend I driver (07:4003, @ffl1k/core SoundDriver) writes the APU registers, played
 *  through the same APU model and audio thread as Legend II (audio.ts). Parts of the game not
 *  ported yet stop with a message (NotPorted*), the save stays as last written. */
import { Engine, SoftReset } from "@ffl1k/core";
import { Ppu, regsFromIo, SCREEN_W, SCREEN_H } from "@ffl2k/render";
import type { Ffl1DataPackage } from "@ffl1k/importer";
import { loadFfl1Sram, saveFfl1Sram, saveFfl1SramBackup } from "./storage";
import { settings, onSettings, update, PALETTES, FAST_FORWARD_KEY, type Settings } from "./settings";
import { gamepads } from "./player";
import { AudioOut } from "./audio";

const FRAME_MS = 1000 / 59.7275;
/** Minimum frames a key press is held for the game (taps are stretched to this). */
const MIN_PRESS = 4;
/** Most engine frames run per display frame (catch-up after a stall × speed). */
const MAX_STEPS = 16;

export interface Player1Ui {
  canvas: HTMLCanvasElement;
  onStatus(msg: string): void;
  onError?(message: string, details: string): void;
  inputs?: (() => number)[];
}

export class Player1 {
  engine!: Engine;
  private ppu!: Ppu;
  private running = false;
  private paused = false;
  private last = 0;
  private acc = 0;
  private keys = 0;
  private taps = 0;
  private ffKey = false;
  private prev = 0;
  private readonly pressedAt = new Map<number, number>();
  private readonly img: ImageData;
  private readonly ctx: CanvasRenderingContext2D;
  private s: Settings = settings();
  private lastSram = new Uint8Array(0x200);
  private sramDirty = false;
  private sessionStart: Uint8Array | null = null;
  private readonly audio = new AudioOut();

  constructor(readonly pkg: Ffl1DataPackage, readonly ui: Player1Ui) {
    this.ctx = ui.canvas.getContext("2d")!;
    ui.canvas.width = SCREEN_W;
    ui.canvas.height = SCREEN_H;
    ui.canvas.style.setProperty("--ar", String(SCREEN_W / SCREEN_H));
    this.img = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    const gesture = () => void this.audio.start();
    window.addEventListener("keydown", gesture, { once: true });
    window.addEventListener("pointerdown", gesture, { once: true });
    window.addEventListener("touchend", gesture, { once: true });
    window.addEventListener("keydown", () => this.audio.wake());
    window.addEventListener("pointerdown", () => this.audio.wake());
    window.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== "KeyM" || e.repeat || (t && (t.tagName === "INPUT" || t.tagName === "SELECT"))) return;
      this.toggleMute();
    });
    window.addEventListener("keydown", (e) => this.key(e, true));
    window.addEventListener("keyup", (e) => this.key(e, false));
    document.addEventListener("visibilitychange", () => this.setPaused(document.hidden));
    window.addEventListener("pagehide", () => void this.persist());
    onSettings((s) => this.apply(s));
  }

  private apply(s: Settings): void {
    this.s = s;
    this.engine?.setOptions({ fastText: s.fastText });
    this.audio.setLatency(s.audioLatency);
    this.audio.setMuted(s.muted);
  }

  /** Mute or unmute (M key, Sound button); remembered on this device. */
  toggleMute(): boolean {
    const muted = !settings().muted;
    update({ muted });
    if (this.running) this.ui.onStatus(muted ? "Sound muted (M)" : "Sound on (M)");
    return muted;
  }

  private romBytes(): Uint8Array {
    const n = Object.keys(this.pkg.segments).length;
    const rom = new Uint8Array(n * 0x4000);
    for (const [k, v] of Object.entries(this.pkg.segments)) rom.set(v, parseInt(k, 16) * 0x4000);
    return rom;
  }

  async start(): Promise<void> {
    const segs = Object.fromEntries(Object.entries(this.pkg.segments).map(([k, v]) => [k, v.slice()]));
    this.engine = new Engine(segs, this.romBytes());
    this.audio.attach(this.engine.g);
    this.apply(this.s);
    const m = this.engine.g.m;
    const sram = await loadFfl1Sram().catch(() => undefined);
    if (sram && sram.length === 0x200) {
      for (let i = 0; i < 0x200; i++) m.sram[i] = sram[i]! & 0x0f;
      this.lastSram.set(m.sram);
      this.sessionStart = m.sram.slice();
    }
    this.ppu = new Ppu(m.vram, m.oam);
    this.engine.g.onLine = (y) => {
      if (y === 0) this.ppu.beginFrame();
      this.ppu.regs = regsFromIo(m.io);
      this.ppu.line(y);
    };
    this.boot();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  /** Power-on (and A+B+Select+Start): the start code 00:0224, then the title. */
  private boot(): void {
    this.engine.g.start(this.engine.run(this.engine.boot()));
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.code === FAST_FORWARD_KEY) { e.preventDefault(); this.ffKey = down; return; }
    const b = this.s.keys[e.code];
    if (b === undefined) return;
    e.preventDefault();
    if (down) { this.keys |= b; this.taps |= b; } else this.keys &= ~b;
  }

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

  /** This frame's buttons; a new press is held for at least MIN_PRESS frames. */
  private sample(): number {
    const f = this.engine.g.frame;
    let raw = this.keys | this.taps | gamepads(this.s.pad);
    this.taps = 0;
    for (const src of this.ui.inputs ?? []) raw |= src();
    for (let b = 1; b < 0x100; b <<= 1) if (raw & b && !(this.prev & b)) this.pressedAt.set(b, f);
    this.prev = raw;
    let v = raw;
    for (const [b, at] of this.pressedAt) if (f - at < MIN_PRESS) v |= b;
    return v & 0xff;
  }

  private tick(now: number): void {
    if (!this.running || this.paused) return;
    this.acc += Math.min(now - this.last, 250);
    this.last = now;
    const sp = this.ffKey ? this.s.fastForward : 1;
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
            this.boot();
            continue;
          }
          this.running = false;
          const name = (e as Error).constructor?.name ?? "";
          const msg = /^NotPorted/.test(name) || /not ported/i.test((e as Error).message)
            ? `Not ported yet: ${(e as Error).message} — this part of Legend I is not available in this build yet.`
            : `Engine error: ${(e as Error).message}`;
          this.ui.onStatus(msg);
          this.ui.onError?.(msg, this.details(e as Error));
          console.error(e);
          void this.persist();
          return;
        }
      }
    }
    if (n) this.draw();
    this.checkSram();
    requestAnimationFrame((t) => this.tick(t));
  }

  private draw(): void {
    const pal = PALETTES[this.s.palette].rgb, f = this.ppu.frame, d = this.img.data;
    for (let i = 0; i < SCREEN_W * SCREEN_H; i++) {
      const c = pal[f[i]!]!;
      d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2]; d[4 * i + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  private checkSram(): void {
    const s = this.engine.g.m.sram;
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== this.lastSram[i]) {
        this.lastSram.set(s);
        this.sramDirty = true;
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
      await saveFfl1SramBackup(b).catch(() => {});
    }
    await saveFfl1Sram(this.engine.g.m.sram.slice());
  }

  /** Text for a bug report: the error, where the game was, and the build. No save or ROM data. */
  private details(e: Error): string {
    const m = this.engine.g.m;
    const hx = (v: number, n = 2) => v.toString(16).padStart(n, "0");
    return [
      `FFTOL ${__APP_VERSION__} (Legend I) on ${navigator.userAgent}`,
      `ROM ${this.pkg.sourceSha256.slice(0, 16)}${this.pkg.verified === false ? " (unverified)" : ""}`,
      `frame ${this.engine.g.frame}, bank ${hx(m.bank)}, map ${hx(m.rd(0xccc7))}, area ${hx(m.rd(0xc3aa))}`,
      `${e.name}: ${e.message}`,
      e.stack ?? "",
    ].join("\n");
  }
}
