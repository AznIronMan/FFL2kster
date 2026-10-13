/** The assembled Legend I engine: subsystems wired the way the original calls across banks. */
import { Game, type Co, type GameOptions } from "./game.js";
import type { Segments } from "./memory.js";
import { installInterrupts } from "./irq.js";
import { TextEngine } from "./text.js";
import { Title } from "./title.js";
import { FieldEngine } from "./field/loop.js";

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

  constructor(segments: Segments, readonly rom: Uint8Array) {
    this.g = new Game(segments);
    installInterrupts(this.g);
    this.text = new TextEngine(this.g);
    this.title = new Title(this.g, this.text);
    const self = this;
    this.field = new FieldEngine(this.g, {
      event: (_g, cmd) => self.event(cmd),
      startMenu: () => { throw new NotPorted("00:269D main menu"); },
      selectMenu: () => { throw new NotPorted("00:3BAD party order"); },
    });
  }

  /** 00:16E0 event commands (C3A9 & 0F). */
  *event(cmd: number): Co {
    throw new NotPorted(`00:16E0 event command ${cmd.toString(16)}`);
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
