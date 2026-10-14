/** The assembled Legend I engine: subsystems wired the way the original calls across banks. */
import { Game, type Co, type GameOptions } from "./game.js";
import type { Segments } from "./memory.js";
import { installInterrupts } from "./irq.js";
import { TextEngine } from "./text.js";
import { Title } from "./title.js";
import { FieldEngine } from "./field/loop.js";
import { Dialogue } from "./field/dialogue.js";
import { Events } from "./field/events.js";
import { MainMenu } from "./field/menumain.js";
import { FieldItems, equip } from "./field/items.js";
import { Facilities } from "./field/facilities.js";
import { Battle } from "./battle/core.js";
import { BattleUi } from "./battle/ui.js";
import { vramBegin, vramEnd, fill, fill16, copy, copyBank, copyBank16, mul16, div16, statNormal } from "./sys.js";
import { GameOver } from "./battle/ui.js";
import { SoundDriver } from "./sound.js";

export class NotPorted extends Error {
  constructor(what: string) {
    super(`not ported yet: ${what}`);
  }
}

export class Engine {
  readonly g: Game;
  readonly text: TextEngine;
  readonly title: Title;
  readonly field: FieldEngine;
  readonly dialogue: Dialogue;
  readonly events: Events;
  readonly menu: MainMenu;
  readonly items: FieldItems;
  readonly facilities: Facilities;
  readonly battle: Battle;
  readonly battleUi: BattleUi;
  /** The bank-07 sound driver, run by the frame tick (07:4003). */
  readonly sound: SoundDriver;

  constructor(segments: Segments, readonly rom: Uint8Array) {
    this.g = new Game(segments);
    installInterrupts(this.g);
    this.sound = new SoundDriver(this.g);
    this.g.hooks.soundTick = () => this.sound.update();
    this.text = new TextEngine(this.g);
    this.title = new Title(this.g, this.text);
    const self = this;
    this.field = new FieldEngine(this.g, {
      events: () => self.events.run(),
      startMenu: () => self.menu.open(),
      selectMenu: () => self.menu.order(),
    });
    this.dialogue = new Dialogue(this.g, { runEvent: () => self.events.run() });
    this.items = new FieldItems(this.g);
    this.menu = new MainMenu(this.g, this.text, this.field, {
      useItem: (_g, a, slot) => self.items.use(a, slot),
      equip: (g) => equip(g),
      quake: () => self.events.quake(),
      shake: () => self.events.shake(),
    });
    this.items.menu = this.menu;
    this.facilities = new Facilities(this.g, this.menu, this.title, this.dialogue);
    this.battle = new Battle(this.g);
    this.battleUi = new BattleUi(this.g, this.text, this.battle);
    this.battle.ui = this.battleUi;
    this.events = new Events(this.g, this.field, this.dialogue, {
      battle: () => self.battleEvent(),
      facility: () => self.facilities.run(),
      giveItem: () => self.facilities.giveItem(),
    });
  }

  /** 00:1BBE — battle area C3AA: the tiles 8800-8FFF dissolved (5 masked passes, in one VRAM
   *  bracket), the battle (06:4000), then the map reloaded (00:22BC); 00:1AB8 follows. */
  *battleEvent(): Co {
    const g = this.g, m = g.m;
    m.hram[0x3d] = m.rd(0xc3aa);
    yield* vramBegin(g);
    const rrc = (v: number) => ((v >> 1) | ((v & 1) << 7)) & 0xff;
    // the passes run in the lines' hblanks (00:069F) over ~18 frames: paced (Game.pacedWrites)
    g.pacedWrites(() => {
      let d = 0x3f;
      for (let e = 5; e; e--) {
        let hl = 0x8800;
        for (let n = 4 * 256; n; n--) {
          m.wr(hl, m.rd(hl) & d); hl++;
          m.wr(hl, m.rd(hl) & d); hl++;
          d = rrc(rrc(d));
        }
        d = rrc(rrc(rrc(d)));
      }
    });
    yield* vramEnd(g);
    g.selectBank(0x06);
    // the stack at 06:4009: CFFC from the field loop's event, 0x10 deeper per text-started event
    // (verified for command 9 -> text -> event 8: CFEC, evt9_069_2112)
    this.battle.sp = 0xcffc - 0x10 * Math.max(0, this.events.depth - 1);
    yield* this.battle.run();
    yield* this.field.loadMap(m.rd(0xccc7));
    m.hram[0x7e] = 1;
    m.wr(0xc5ca, 0);
    m.wr(0xc5b1, 0);
    m.wr(0xc5ba, 0);
    m.wr(0xc5c1, 0x21);
    m.wr(0xc5c2, 0x9c);
  }

  setOptions(o: Partial<GameOptions>): void {
    Object.assign(this.g.options, o);
  }

  /** The top level: `start`, then after a defeat (06:6298 jp 00:0101) the start again. */
  *run(start: Co): Co {
    let co = start;
    for (;;) {
      try {
        yield* co;
        return;
      } catch (e) {
        if (!(e instanceof GameOver)) throw e;
        co = this.boot(e.h);
      }
    }
  }

  /** 00:0224 — the start (power-on through 00:0101, and the restart after a defeat): IO reset,
   *  C000-CEFF / D000-DFFF / FF80-FFFE cleared (C427 = 1 on a cold start: no 1B E4 signature at
   *  C425), the DMA routine and the RAM vectors, the 128 random counters C300 from DIV, the random
   *  table CB00 (00:02A0), the sound driver reset (07:4000), C800 from 05:4E40, interrupts on,
   *  the font (03:7100, each byte doubled) and the shared tiles (02:7A00, 02:7F00) to VRAM; then
   *  the title (03:7D50). h: the h register at the jump (power-on: 01 from the boot ROM). */
  *boot(h = 0x01): Co {
    const g = this.g, m = g.m;
    g.ime = false;
    m.wr(0xff40, 0x80);
    m.wr(0xff0f, 0);
    m.hram[0x7f] = 0;
    m.wr(0xff41, 0);
    for (let i = 0; i < 3; i++) m.wr(((h & 0xff) << 8) | (0x24 + i), 0); // ld l,$24 with h as left
    for (const r of [0xff47, 0xff48, 0xff49, 0xff43, 0xff42]) m.wr(r, 0);
    const cold = !(m.rd(0xc425) === 0x1b && m.rd(0xc426) === 0xe4);
    fill16(m, 0xc000, 0x0f00, 0);
    fill16(m, 0xd000, 0x1000, 0);
    fill(m, 0xff80, 0x7f, 0);
    m.wr(0xc425, 0x1b);
    m.wr(0xc426, 0xe4);
    m.wr(0xc427, cold ? 1 : 0);
    copy(m, 0x00f0, 0xff80, 8);
    copy(m, 0x00dd, 0xc380, 0x13);
    if (g.hooks.divSeed) g.hooks.divSeed(g);
    else for (let i = 0; i < 0x80; i++) m.wr(0xc300 + i, Math.floor(Math.random() * 256));
    // 00:02A0: x = 1; 256 times x = (x * 11) mod 400, mirrored (400 - x) when x >= 200 unless
    // its low byte is 0; CB00 + c = x / 2
    m.hram[0x08] = 1;
    m.hram[0x09] = 0;
    for (let c = 0; c < 256; c++) {
      const x = m.hram[0x08]! | (m.hram[0x09]! << 8);
      const [, lo] = mul16(x, 0x0b);
      let [, de] = div16(m, lo, 0x400);
      if ((de >> 8) >= 2 && (de & 0xff)) de = (0x400 - de) & 0xffff;
      m.hram[0x08] = de & 0xff;
      m.hram[0x09] = de >> 8;
      m.wr(0xcb00 + c, (de >> 1) & 0xff);
    }
    g.selectBank(0x07);
    this.sound.init(); // 07:4000
    copyBank(g, 0x05, 0x4e40, 0xc800, 0);
    g.ime = false;
    m.wr(0xff45, 0);
    m.wr(0xff0f, 0);
    m.hram[0x7f] = 0x03;
    m.wr(0xff41, 0x40);
    m.wr(0xc39a, 0xc3);
    m.wr(0xc39b, 0xd3);
    m.wr(0xc39c, 0x06);
    statNormal(g); // 00:044F
    g.selectBank(0x03);
    yield* vramBegin(g);
    let de = 0x7100, hl = 0x9000;
    for (let bc = 0x3b8; bc; bc--) {
      const a = m.rd(de++);
      m.wr(hl++, a);
      m.wr(hl++, a);
    }
    copy(m, de, hl, 0x90);
    copyBank16(g, 0x02, 0x7a00, 0x8800, 0x400);
    copyBank(g, 0x02, 0x7f00, 0x8f00, 0);
    yield* vramEnd(g);
    copyBank(g, 0x05, 0x4e40, 0xc800, 0);
    g.selectBank(0x03);
    yield* this.fromTitle();
  }

  /** From the title screen (03:7D50, reached by the boot code with bank 03 selected). */
  *fromTitle(): Co {
    const choice = yield* this.title.title();
    if (choice === "new") {
      yield* this.title.newGame();
      yield* this.field.newGame();
      return;
    }
    yield* this.field.continueGame();
  }
}
