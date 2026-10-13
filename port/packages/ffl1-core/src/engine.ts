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
    this.events = new Events(this.g, this.field, this.dialogue, {
      battle: () => { throw new NotPorted("00:1BBE battle"); },
      facility: () => self.facilities.run(),
      giveItem: () => self.facilities.giveItem(),
    });
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
