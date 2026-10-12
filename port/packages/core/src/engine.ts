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
  }

  /** Call a routine by original address. */
  *far(addr: number, regs: Regs = {}): Co<number | void> {
    const x = this.extra.get(addr);
    if (x) return yield* x(this, regs);
    const m = this.g.m;
    switch (addr) {
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
