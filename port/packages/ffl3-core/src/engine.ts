/** The assembled Legend III engine: subsystems wired the way the original calls across banks. */
import { Game, type Co, type GameOptions } from "./game.js";
import type { Segments } from "./memory.js";
import { installInterrupts, NotPorted } from "./irq.js";
import { frameSprites } from "./sprites.js";
import { title, type TitleChoice } from "./title.js";
import { fieldWorkBanked, slideRaster } from "./window.js";
import { fadeIn, far0 } from "./sys.js";
import { printText } from "./text.js";
import { waveRaster } from "./wave.js";
import { fieldLoop } from "./field.js";
import { testFlag, setFlag } from "./objects.js";

export class Engine {
  readonly g: Game;

  constructor(segments: Segments, readonly rom: Uint8Array) {
    this.g = new Game(segments);
    installInterrupts(this.g, (g) => this.frameWork(g));
    this.g.handlers.set(0x3631, slideRaster);
    this.g.handlers.set(0x7ec2, waveRaster);
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

  /** 01:7C79 — from the title (reached by the start code with bank 01 selected), then the rest
   *  of the start code (00:023F). */
  *fromTitle(): Co<TitleChoice> {
    const c = yield* title(this.g);
    yield* this.afterTitle();
    return c;
  }

  /** 00:023F — after the title: a new game (story flag 31 clear) fades in and runs the opening
   *  script 09:6015 in the box (1,1) 18 x 6, then sets flag 31; else (a saved game) the map load
   *  00:027D and 00:3D38; then LYC 0 and the field loop 00:0265. */
  *afterTitle(): Co {
    const g = this.g, m = g.m;
    if (testFlag(m, 0x31)) throw new NotPorted("00:025C (a saved game: the map load)");
    yield* fadeIn(g);
    yield* far0(g, 0x09, () => printText(g, 0x00, 0x6015, 0x0101, 0x0612));
    setFlag(m, 0x31);
    m.wr(0xff45, 0);
    yield* fieldLoop(g);
  }
}
