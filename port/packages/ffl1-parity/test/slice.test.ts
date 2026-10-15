/** Legend I scenario parity: PyBoy traces (tools/ffl1/trace_lib.py, generated locally from the
 *  player's ROM, never committed) replayed through @ffl1k/core; every frame wait's machine state
 *  (VRAM, WRAM, OAM, HRAM; sound/stack/timing excluded, see IGNORE) and every screen must match.
 *  Skipped without the ROM or the trace. */
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace, replay, summarize, summarizeWaits } from "../src/index.js";

const TRACES: [string, string][] = [
  ["title1", "boot to the title screen, idle"],
  ["probe1", "title, prologue (A held), class select, name entry"],
  ["newgame1", "new game: prologue, class, name, the first town; objects walk"],
  ["walk1", "the first town: walking, scrolling"],
  ["walk2", "the first town: a longer walk with objects (joypad re-phased)"],
  ["talk1", "talk to a townsperson: dialogue, a nested event"],
  ["menu1", "the main menu: abilities, items, equipment, close"],
  ["order1", "the party order screen"],
  ["inn1", "the inn: stay (BCD price), the rest, back to the field"],
  ["shop1", "a shop: buy and sell"],
  ["guild1", "the guild: recruit a member (class, name), back to the field"],
  ["care1", "field use of the ability CARE (00:39AA: h never loaded, MBC2 bank selects; HP unchanged)"],
  ["battle1", "a battle (event 8, area 16): intro slide, menus, SABER, the lizards' bites, hit shakes"],
  ["battle2", "the same battle to victory: gold, the map back"],
  ["flee1", "Run until the escape succeeds (one failed try), the map back"],
  ["power1", "power-on from the start code 00:0224 (DIV seed from the trace), the title, a new game begun"],
  ["defeat1", "a party at 1 HP wiped out: game over, a button, the restart (00:0224) and the title"],
  ["title2", "the title's cursor, Select, B eleven times with Down + Start held: the sound test (03:7E4A)"],
  ["newgame2", "name entry: a letter, its deletion (03:7BA6), B with the name empty: the class select again"],
  ["reset1", "save, A+B+Select+Start (00:071C: the start 00:0224), the title's CONTINUE, the saved map"],
  ["sphere1", "the bag's sphere row (00:2810): a sphere used, the objects placed, the quake (00:1779, 1AB8)"],
  ["sphere2", "the spheres at story stage 2 on map 1: every sphere shown, the shakes (00:1793), nibble 0A = 5"],
  ["empty1", "the menu's Save, then Abil: the member choice on empty slots (00:2977: bc = CC00 + the offset)"],
];

describe.skipIf(!haveRom())("FFL1 scenario parity", () => {
  for (const [name, what] of TRACES) {
    it.skipIf(!haveTrace(name))(`${name}: ${what}`, () => {
      const r = replay(name, { keepGoing: true });
      const info = `waits ${r.nWaits}/${r.trace.waitFrames.length} busy ${r.busy} tickPhase ${r.tickPhase} late ${r.lateWrites} tears ${r.tears} raster ${r.rasterEdges} blank ${r.lcdBlanks}`;
      if (r.error || r.waits.length || r.diffs.length) console.log(`${name}: ${info} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}\n${summarize(r.diffs)}`);
      expect(r.error).toBeUndefined();
      expect(r.nWaits).toBe(r.trace.waitFrames.length);
      expect(r.waits).toEqual([]);
      expect(r.diffs).toEqual([]);
    });
  }
});
