/** The assembled engine: subsystems wired together the way the original's code calls across
 *  banks. Routines are addressed by their original location (bank << 16 | address for banked
 *  code), which keeps the call graph auditable against the disassembly. */
import { Game, type Co } from "./game.js";
import type { Segments } from "./memory.js";
import { installInterrupts, SoftReset } from "./irq.js";
import { FieldEngine, type FieldCalls } from "./field/loop.js";
import { installRasterHandlers } from "./field/effects.js";
import { loadPlayerTiles, playerSpriteSource, loadObjectTiles, drawPlayer } from "./field/sprites.js";
import { TextEngine, spriteTick, type Regs } from "./text/engine.js";
import { Bank1 } from "./menu/bank1.js";
import { enterField, saveFieldPosition } from "./field/load.js";
import { fill, copy, copyBank } from "./sys.js";
import { vramBegin, vramEnd } from "./field/sprites.js";
import { installSound } from "./sound/index.js";
import { installBattle } from "./battle/main.js";
import { installBattleDisplay } from "./battle/display.js";
import { installBattleMenus } from "./menu/battle.js";
import { installFieldMenus } from "./menu/field.js";

export class NotPorted extends Error {
  constructor(what: string) {
    super(`not ported yet: ${what}`);
  }
}

const hex = (a: number) => (a > 0xffff ? `${(a >> 16).toString(16).padStart(2, "0")}:${(a & 0xffff).toString(16).padStart(4, "0")}` : `00:${a.toString(16).padStart(4, "0")}`);

export class Engine {
  readonly g: Game;
  readonly field: FieldEngine;
  readonly text: TextEngine;
  readonly bank1: Bank1;
  /** Overrides for routines not ported yet (tests stub them). */
  readonly extra = new Map<number, (e: Engine, regs: Regs) => Co<number | void>>();

  constructor(segments: Segments, readonly rom: Uint8Array) {
    this.g = new Game(segments);
    installInterrupts(this.g);
    installRasterHandlers(this.g);
    this.g.hooks.spriteTickFf96 = (g) => spriteTick(g.m);
    const self = this;
    const fieldCalls: FieldCalls = {
      script: (_g, de) => self.text.script(de),
      startMenu: () => self.far(0x15000) as Co,
      selectMenu: () => self.far(0x15003) as Co,
      event4: (_g, de) => self.text.event4(de),
    };
    this.field = new FieldEngine(this.g, rom, fieldCalls);
    this.text = new TextEngine(this.g, {
      far: (_g, addr, regs) => self.far(addr, regs),
      reset: () => {
        throw new SoftReset();
      },
    });
    this.bank1 = new Bank1(this.g, this.text, { saveFieldPosition: (g) => saveFieldPosition(g.m) });
    // Subsystems that register their routines by original address (engine.extra) and hooks.
    installSound(this.g);
    installBattle(this);
    installBattleDisplay(this);
    installBattleMenus(this);
    installFieldMenus(this);
  }

  /** 00:0200 — power-on / reset, then the title (01:500F) and the field (00:1900 new game,
   *  00:1903 continue). */
  *main(): Co {
    yield* this.boot();
    yield* this.fromTitle();
  }

  /** From the title screen on (traces start here). */
  *fromTitle(): Co {
    const m = this.g.m;
    m.selectBank(0x01);
    const cont = yield* this.bank1.title();
    yield* enterField(this.g, this.rom, cont);
    yield* this.field.loop();
  }

  /** 00:0200 — clear RAM (keeping the RNG counters C0A0-C0FF over a warm reset), seed the RNG
   *  counters from DIV on a cold start, set up vectors and load the shared tiles. */
  *boot(): Co {
    const m = this.g.m, g = this.g;
    m.wr(0xff40, 0x80);
    m.io[0x0f] = 0;
    m.hram[0x7f] = 0;
    for (const r of [0x41, 0x47, 0x48, 0x49, 0x43, 0x42]) m.wr(0xff00 | r, 0);
    const warm = m.rd(0xc776) === 0x1b && m.rd(0xc777) === 0xe4 ? 1 : 0;
    fill(m, 0xc000, 0xa0, 0);
    fill(m, 0xc100, 0xd00, 0);
    fill(m, 0xcf00, 0x1100, 0);
    fill(m, 0xff80, 0x7f, 0);
    m.wr(0xc776, 0x1b);
    m.wr(0xc777, 0xe4);
    m.wr(0xc778, warm);
    if (!warm) {
      let a = m.io[0x04]!;
      for (let i = 0; i < 0x40; i++) m.wr(0xc0a0 + i, a++);
    }
    m.wr(0xc779, 0xa0);
    m.wr(0xc77a, 0xcc);
    copy(m, 0x00f2, 0xff80, 8);
    copy(m, 0x00e6, 0xc0e0, 0x0c);
    this.g.hooks.soundInit?.(g);
    m.io[0x45] = 0;
    m.io[0x0f] = 0;
    m.hram[0x7f] = 0x03;
    m.wr(0xff41, 0x40);
    m.wr(0xc703, 0xc3); m.wr(0xc704, 0xdf); m.wr(0xc705, 0x16);
    m.wr(0xc706, 0xc3); m.wr(0xc707, 0xd9); m.wr(0xc708, 0x16);
    m.selectBank(0x03);
    yield* vramBegin(g);
    copyBank(m, 0x03, 0x7f00, 0x8700, 0x100);
    yield* vramEnd(g);
    m.selectBank(0x04);
    yield* vramBegin(g);
    copyBank(m, 0x04, 0x4800, 0x8800, 0x800);
    yield* vramEnd(g);
    m.wr(0x0000, 0x0a);
    if (!(m.rd(0xa781) === 0x1b && m.rd(0xa782) === 0xe4)) m.wr(0xa780, 1);
    m.wr(0x0000, 0);
    for (let k = 0; k < 4; k++) fill(m, 0xc200 + 0x20 * k, 4, 0xff);
  }

  /** Call a routine by original address. */
  *far(addr: number, regs: Regs = {}): Co<number | void> {
    return yield* this.call(addr, regs);
  }

  /** 00:04BF far call around `far`: C0E5 = the caller's A, C0E7/C0E8 = target, the target bank
   *  mapped for the call and the caller's bank restored after it. For call sites that use
   *  `call 04BF` (most use `rst $28` + call and keep their own bookkeeping). */
  *farcall(addr: number, a: number, regs: Regs = {}): Co<number | void> {
    const m = this.g.m;
    m.wr(0xc0e5, a & 0xff);
    m.wr(0xc0e7, addr & 0xff);
    m.wr(0xc0e8, (addr >> 8) & 0xff);
    const prev = m.selectBank(addr >> 16);
    try {
      return yield* this.call(addr, regs);
    } finally {
      m.selectBank(prev);
    }
  }

  private *call(addr: number, regs: Regs): Co<number | void> {
    const x = this.extra.get(addr);
    if (x) return yield* x(this, regs);
    const m = this.g.m;
    switch (addr) {
      case 0x1500c: return yield* this.bank1.menu.run();
      case 0x15006: // 00:0F8C reaches it with a far call (A = 2)
        if (regs.a !== undefined) return yield* this.farcall(0x15006, regs.a);
        return yield* this.bank1.companions();
      case 0x1906: return yield* this.field.sequence(regs.hl ?? 0);
      case 0x1909: return yield* this.field.refreshNpcs();
      case 0x1915: // 00:1B5F — rebuild the field, then bank 0D
        yield* this.field.restoreField();
        m.selectBank(0x0d);
        return;
      case 0x191b: // 00:2FB1
        if (m.rd(0xc452)) yield* loadObjectTiles(this.g);
        yield* loadPlayerTiles(this.g);
        return;
      case 0x1921: // 00:1F1A
        yield* loadPlayerTiles(this.g);
        playerSpriteSource(m);
        drawPlayer(m, m.rd(0xc436));
        return;
    }
    throw new NotPorted(hex(addr));
  }
}
