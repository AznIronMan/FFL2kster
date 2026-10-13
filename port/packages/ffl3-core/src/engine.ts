/** The assembled Legend III engine: subsystems wired the way the original calls across banks. */
import { Game, type Co, type GameOptions } from "./game.js";
import type { Segments } from "./memory.js";
import { installInterrupts, NotPorted } from "./irq.js";
import { frameSprites } from "./sprites.js";
import { title, type TitleChoice } from "./title.js";
import { fieldWorkBanked, slideRaster } from "./window.js";

export class Engine {
  readonly g: Game;

  constructor(segments: Segments, readonly rom: Uint8Array) {
    this.g = new Game(segments);
    installInterrupts(this.g, (g) => this.frameWork(g));
    this.g.handlers.set(0x3631, slideRaster);
  }

  /** 00:3557 — the frame work while CD3D is set: in the field (CDC4, or the text window at WY
   *  50) the object and map work of bank 01 (00:3575); otherwise the party figures (00:2192) and
   *  00:1ED7. */
  private frameWork(g: Game): void {
    const m = g.m;
    if (m.rd(0xcdc4) || m.rd(0xff4a) === 0x50) { fieldWorkBanked(g); return; }
    frameSprites(g);
    if (m.rd(0xcd42)) throw new NotPorted("0B:7CDD (00:1ED7)");
  }

  setOptions(o: Partial<GameOptions>): void {
    Object.assign(this.g.options, o);
  }

  /** 01:7C79 — from the title (reached by the start code with bank 01 selected). */
  *fromTitle(): Co<TitleChoice> {
    return yield* title(this.g);
  }
}
