/** The assembled Legend III engine: subsystems wired the way the original calls across banks. */
import { Game, type Co, type GameOptions } from "./game.js";
import type { Segments } from "./memory.js";
import { installInterrupts, NotPorted } from "./irq.js";
import { frameSprites } from "./sprites.js";
import { title, type TitleChoice } from "./title.js";
import { fieldWorkBanked, slideRaster } from "./window.js";
import { fadeIn, far0, farSync, copy, fill } from "./sys.js";
import { printText } from "./text.js";
import { waveRaster } from "./wave.js";
import { fieldLoop } from "./field.js";
import { menuFrameWork } from "./fieldmenu.js";
import { testFlag, setFlag } from "./objects.js";
import { loadMap } from "./mapload.js";
import { statIrqOn } from "./cont.js";
import { SoundDriver } from "./sound.js";

/** The ROM as the engine's data segments (bank "00".."0F" -> 16 KiB each). */
export function segmentsOf(rom: Uint8Array): Record<string, Uint8Array> {
  const s: Record<string, Uint8Array> = {};
  for (let b = 0; b < rom.length / 0x4000; b++) s[b.toString(16).padStart(2, "0")] = rom.slice(b * 0x4000, (b + 1) * 0x4000);
  return s;
}

export class Engine {
  readonly g: Game;

  constructor(segments: Segments, readonly rom: Uint8Array) {
    this.g = new Game(segments);
    installInterrupts(this.g, (g) => this.frameWork(g));
    this.g.handlers.set(0x3631, slideRaster);
    this.g.handlers.set(0x7ec2, waveRaster);
    const sound = new SoundDriver(this.g);
    this.g.hooks.soundTick = () => sound.tick(); // 0F:4006 (the callers select bank 0F)
  }

  /** 00:3557 — the frame work while CD3D is set: in the field (CDC4, or the text window at WY
   *  50) the object and map work of bank 01 (00:3575); otherwise the party figures (00:2192) and
   *  00:1ED7. */
  private frameWork(g: Game): void {
    const m = g.m;
    if (m.rd(0xcdc4) || m.rd(0xff4a) === 0x50) { fieldWorkBanked(g); return; }
    frameSprites(g);
    if (m.rd(0xcd42)) farSync(g, 0x0b, () => menuFrameWork(g)); // 00:1ED7
  }

  setOptions(o: Partial<GameOptions>): void {
    Object.assign(this.g.options, o);
  }

  /** 00:0100 / 00:0200 — the start code: di; at line 91 the LCD off (00:374A); SP = CFFF; the OAM
   *  DMA routine 00:3730 -> FF80 (10 bytes, 00:3727); FF8A-FFFC, C000-CEFF and D000-DFFF cleared
   *  (00:39B8); ROM bank 1 (00:3910: C0B1 = 1, C0B0 = 0); the palettes 0; 9800-9FFF blank (FF);
   *  the vblank vector 00:11A2 (00:3D46) and the STAT vector 00:11E3 (00:3D5A); STAT 0, IE = 1
   *  (vblank), LCDC C3; ei; the title (01:7C79) and the rest of the start code (00:023F). */
  *fromStart(): Co<TitleChoice> {
    const g = this.g, m = g.m;
    g.ime = false;
    m.wr(0xfffd, 0x02); // call 00:374A on the power-on stack (SP FFFE): its return 0204
    m.wr(0xfffc, 0x04);
    yield* g.untilLine(0x91);
    m.wr(0xff40, m.rd(0xff40) & 0x7f);
    copy(m, 0x3730, 0xff80, 10);
    fill(m, 0xff8a, 0x73, 0);
    fill(m, 0xc000, 0x0f00, 0);
    fill(m, 0xd000, 0x1000, 0);
    m.wr(0xc0b1, 0x01);
    m.wr(0x2100, 0x01);
    m.wr(0xc0b0, 0x00);
    m.wr(0xff47, 0);
    m.wr(0xff48, 0);
    m.wr(0xff49, 0);
    fill(m, 0x9800, 0x0800, 0xff);
    m.wr(0xc0ba, 0xa2);
    m.wr(0xc0bb, 0x11);
    m.wr(0xc0b9, 0xc3);
    m.wr(0xc0bd, 0xe3);
    m.wr(0xc0be, 0x11);
    m.wr(0xc0bc, 0xc3);
    m.wr(0xff41, 0);
    m.hram[0x7f] = 0x01;
    yield* g.point(0x023b); // (the clears before take frames of CPU time with the LCD off)
    m.wr(0xff40, 0xc3);
    yield* g.reti(); // ei
    return yield* this.fromTitle();
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
    if (testFlag(m, 0x31)) { // 00:025C
      yield* loadMap(g);
      statIrqOn(m);
    } else {
      yield* fadeIn(g);
      yield* far0(g, 0x09, () => printText(g, 0x00, 0x6015, 0x0101, 0x0612));
      setFlag(m, 0x31);
    }
    m.wr(0xff45, 0);
    yield* fieldLoop(g);
  }
}
