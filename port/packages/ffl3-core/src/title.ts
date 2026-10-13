/** Legend III title screen (01:7C79, called by the start code at 00:023C) and the menu input
 *  dispatcher 00:1E51. */
import type { Game, Co } from "./game.js";
import { bracketEnter, copy, decompress, pushBank, popBank, far0, farcall, farSync, vramCopy, fadeIn, windowOn,
  lowBit, soundOk, soundBuzz, wait1 } from "./sys.js";
import { resetSprites } from "./sprites.js";
import { printText } from "./text.js";
import { NotPorted } from "./irq.js";

/** 0B:6D22 — the key repeat pause after a menu action: a direction held (or pressed) waits up
 *  to 15 frames (8 for a new press; CD38 set: 14), A/B/Start 30, Select held 1; any new press
 *  ends it; CD38 = 0. */
export function* keyRepeat(g: Game): Co {
  const m = g.m;
  let b = 0x0f;
  const e = m.rd(0xcdaf);
  let held = false;
  if (e & 0xf0) held = true;
  else {
    b = 0x08;
    const d = m.hram[0x0a]!;
    if (d & 0xf0) held = true;
    else {
      if (!((e | d) & 0x0b)) { m.wr(0xcd38, 0); return; }
      b = 0x1e;
    }
  }
  if (held && m.rd(0xcd38)) {
    b = (b - 1) & 0xff;
    if (!b) { m.wr(0xcd38, 0); return; }
  }
  if (m.hram[0x0a]! & 0x04) b = 1;
  for (;;) {
    yield* wait1(g);
    if (m.hram[0x0b]) break;
    b = (b - 1) & 0xff;
    if (!b) break;
  }
  m.wr(0xcd38, 0);
}

/** A menu action: true leaves the menu (the handler's `pop hl; pop hl; ret`). */
export type MenuHandler = (index: number) => Co<boolean>;

/** 00:1E51 — wait for a button (Select ignored), then the handler for the lowest set bit (A, B,
 *  Select, Start, Right, Left, Up, Down; the first four with the cursor sound FFBC = 3A); the
 *  handlers that return go back through the key repeat pause 0B:6D22. */
export function* menuInput(g: Game, handler: MenuHandler): Co {
  const m = g.m;
  if (m.hram[0x0a]! & 0x0b) yield* farcall(g, 0x0b, () => keyRepeat(g));
  for (;;) {
    let a: number;
    do {
      yield* wait1(g);
      m.wr(0xcdaf, m.hram[0x0b]!);
      a = m.hram[0x0a]! & 0xfb;
    } while (!a);
    const i = lowBit(a);
    if (i < 4) soundOk(m);
    if (yield* handler(i)) return;
    yield* farcall(g, 0x0b, () => keyRepeat(g));
  }
}

/** 0B:6D04 — the window at the top left (WY 0, WX 7) and on. */
export function windowTop(g: Game): void {
  const m = g.m;
  m.wr(0xff4a, 0);
  m.wr(0xff4b, 7);
  windowOn(m);
}

export type TitleChoice = "new" | "continue";

/** 01:7C79 — the title: music 6, the bracket, the target palettes (01:7DDA -> CDB4), the title
 *  picture (03:5C00 decompressed to D000 -> 9000), the font (03:4000 -> 8800), the window, the
 *  sprites, the cursor tiles (03:71B5 -> 8180), the logo map (8 rows of 16 tiles at 9C22), "New
 *  Game / Continue" (09:7215) and the copyright (09:7215 next), the cursor objects, the fade in,
 *  then the menu: Up/Down move the cursor (C080 ^ 10), A chooses. */
export function* title(g: Game): Co<TitleChoice> {
  const m = g.m;
  m.wr(0xced9, 0x0a);
  m.hram[0x3a] = 0x06;
  yield* bracketEnter(g);
  copy(m, 0x7dda, 0xcdb4, 3);
  // 00:1D7F
  pushBank(g, 0x03);
  decompress(m, 0x5c00, 0x6287, 0xd000);
  popBank(g);
  let de = 0x8800;
  [, de] = yield* far0(g, 0x03, function* () { return vramCopy(m, 0x4000, de, 0x0800); });
  [, de] = yield* far0(g, 0x00, function* () { return vramCopy(m, 0xd000, de, 0x0800); });
  farSync(g, 0x0b, () => windowTop(g));
  yield* farcall(g, 0x09, () => resetSprites(g));
  yield* far0(g, 0x03, function* () { return vramCopy(m, 0x71b5, 0x8180, 0x10); });
  de = 0x9c22;
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < 16; i++) m.wr(0xc880 + i, (r * 16 + i) & 0xff);
    const at = de;
    yield* far0(g, 0x00, function* () { return vramCopy(m, 0xc880, at, 0x10); });
    de = (de + 0x20) & 0xffff;
  }
  let { hl } = yield* far0(g, 0x09, () => printText(g, 0x04, 0x7215, 0x0a06, 0x0408));
  ({ hl } = yield* far0(g, 0x09, () => printText(g, 0x04, hl, 0x0e00, 0x0414)));
  m.wr(0xc080, 0x78); m.wr(0xc081, 0x30);
  m.wr(0xc060, 0x53); m.wr(0xc061, 0x52);
  yield* fadeIn(g);
  let choice: TitleChoice | null = null;
  yield* menuInput(g, function* (i) {
    if (i === 0) {
      choice = m.rd(0xc080) === 0x68 ? "new" : "continue";
      throw new NotPorted("01:7D21 (the title choice)");
    }
    if (i >= 6) { m.wr(0xc080, m.rd(0xc080) ^ 0x10); return false; }
    yield* soundBuzz(g);
    return false;
  });
  return choice ?? "new";
}
