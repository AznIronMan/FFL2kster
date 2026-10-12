/** The game player: runs the engine at the Game Boy's 59.73 Hz, draws the PPU frame on a canvas
 *  and maps keyboard/gamepad input. Battery RAM (saves) is persisted in IndexedDB. */
import { Engine, NotPorted, SoftReset, BTN } from "@ffl2k/core";
import { Ppu, regsFromIo, SCREEN_W, SCREEN_H } from "@ffl2k/render";
import type { DataPackage } from "@ffl2k/importer";
import { loadSram, saveSram } from "./storage";

const FRAME_MS = 1000 / 59.7275;
/** DMG-like greens are an optional extra; default is the plain 4 greys. */
const PALETTE = [[0xff, 0xff, 0xff], [0xaa, 0xaa, 0xaa], [0x55, 0x55, 0x55], [0x00, 0x00, 0x00]];

const KEYS: Record<string, number> = {
  ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT,
  KeyZ: BTN.A, KeyX: BTN.B, Enter: BTN.START, ShiftRight: BTN.SELECT, ShiftLeft: BTN.SELECT, Backspace: BTN.SELECT,
};

export interface PlayerUi {
  canvas: HTMLCanvasElement;
  onStatus(msg: string): void;
}

export class Player {
  private engine!: Engine;
  private ppu!: Ppu;
  private running = false;
  private last = 0;
  private acc = 0;
  private held = 0;
  private img: ImageData;
  private ctx: CanvasRenderingContext2D;
  private sramDirty = false;
  private lastSram = new Uint8Array(0x2000);

  constructor(readonly pkg: DataPackage, readonly ui: PlayerUi) {
    ui.canvas.width = SCREEN_W;
    ui.canvas.height = SCREEN_H;
    this.ctx = ui.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    window.addEventListener("keydown", (e) => this.key(e, true));
    window.addEventListener("keyup", (e) => this.key(e, false));
    document.addEventListener("visibilitychange", () => { if (document.hidden) void this.persist(); });
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
    this.held = down ? this.held | b : this.held & ~b;
  }

  private pad(): number {
    const p = navigator.getGamepads?.()[0];
    if (!p) return 0;
    let v = 0;
    const btn = (i: number) => p.buttons[i]?.pressed;
    if (btn(0)) v |= BTN.A;
    if (btn(1)) v |= BTN.B;
    if (btn(8)) v |= BTN.SELECT;
    if (btn(9)) v |= BTN.START;
    if (btn(12) || (p.axes[1] ?? 0) < -0.5) v |= BTN.UP;
    if (btn(13) || (p.axes[1] ?? 0) > 0.5) v |= BTN.DOWN;
    if (btn(14) || (p.axes[0] ?? 0) < -0.5) v |= BTN.LEFT;
    if (btn(15) || (p.axes[0] ?? 0) > 0.5) v |= BTN.RIGHT;
    return v;
  }

  private tick(now: number): void {
    if (!this.running) return;
    this.acc += Math.min(now - this.last, 250);
    this.last = now;
    let n = 0;
    while (this.acc >= FRAME_MS && n < 4) {
      this.acc -= FRAME_MS;
      n++;
      this.engine.g.buttons = this.held | this.pad();
      try {
        this.engine.g.runFrame();
      } catch (e) {
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
