/** Sound: the bank-0E driver (see driver.ts) hooked into the frame tick and the boot code. */
import type { Game } from "../game.js";
import { soundInit, soundUpdate } from "./driver.js";

export * from "./driver.js";

/** Install the sound driver on a Game:
 *  - `hooks.soundTick` = 00:16F9's `ld a,$0E; call 04B1; push af; call 4000; …; pop af;
 *    call 04B1`: select bank 0E (FF88), run the driver, select the previous bank again;
 *  - `hooks.soundInit` = 00:0280's `ld a,$0E; rst $28; call 4003`: select bank 0E (left
 *    selected, as in the original, until boot selects bank 03) and initialise the driver. */
export function installSound(g: Game): void {
  g.hooks.soundTick = (g) => {
    const prev = g.m.selectBank(0x0e);
    soundUpdate(g.m);
    g.m.selectBank(prev);
  };
  g.hooks.soundInit = (g) => {
    g.m.selectBank(0x0e);
    soundInit(g.m);
  };
}
