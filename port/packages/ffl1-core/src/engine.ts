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
import { vramBegin, vramEnd } from "./sys.js";

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

  constructor(segments: Segments, readonly rom: Uint8Array) {
    this.g = new Game(segments);
    installInterrupts(this.g);
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
    yield* vramEnd(g);
    g.selectBank(0x06);
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
