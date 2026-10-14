/** Legend III: the title's choice (01:7D21) and the new game (01:7D40): the party, map state and
 *  story flags from their initial tables, the prologue text (09:5EAD) over the opening scene. */
import type { Game, Co } from "./game.js";
import { copyB, copyBC, far0, far0Sync, farSync, farcall, fadeOut, textBegin, windowOff, fill } from "./sys.js";
import { NotPorted } from "./irq.js";
import { windowTop } from "./title.js";
import { printText } from "./text.js";
import { names } from "./names.js";
import { continueGame, gameLoaded } from "./cont.js";

/** 01:7DFD — the window map (9C00, 0x240) blank (FF, 0F:792C). */
export function windowClear(g: Game): void {
  farSync(g, 0x0f, () => { fill(g.m, 0x9c00, 0x240, 0xff); });
}

/** 01:7D21 — the title choice (cursor C080 68 = New Game): fade out, the cursor objects off, the
 *  window at the top, CD3D + 1 and the bracket; Continue loads the save (09:4964), else (or
 *  when there is none) a new game. */
export function* titleChoice(g: Game, cursor: number): Co {
  const m = g.m;
  yield* fadeOut(g);
  m.wr(0xc080, 0);
  m.wr(0xc060, 0);
  farSync(g, 0x0b, () => windowTop(g));
  yield* textBegin(g);
  if (cursor !== 0x68 && (yield* farcall(g, 0x09, () => continueGame(g)))) { // 09:4964, jp z 01:7DC5
    yield* gameLoaded(g);
    return;
  }
  yield* newGame(g);
}

/** 01:7D40 — a new game: the party records (07:7A81 -> C500, 0x1E0), the map state (07:7E41 ->
 *  C6E0, 0x60), the story flags (01:7DDD -> C760, 0x20), the window blank, CA6E = 1, window off,
 *  the prologue (09:5EAD in the box (1,1) 18 x 6, tile by tile); then the names. */
function* newGame(g: Game): Co {
  const m = g.m;
  far0Sync(g, 0x07, () => copyBC(m, 0x7a81, 0xc500, 0x01e0));
  far0Sync(g, 0x07, () => copyB(m, 0x7e41, 0xc6e0, 0x60));
  far0Sync(g, 0x00, () => copyB(m, 0x7ddd, 0xc760, 0x20));
  farSync(g, 0x01, () => windowClear(g));
  m.wr(0xca6e, 1);
  windowOff(m);
  yield* far0(g, 0x09, () => printText(g, 0x00, 0x5ead, 0x0101, 0x0612));
  yield* names(g);
}

