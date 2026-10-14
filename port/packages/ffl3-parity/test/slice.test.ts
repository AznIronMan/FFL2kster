/** Legend III scenario parity: PyBoy traces (tools/ffl3/traces.py, generated locally from the
 *  player's ROM, never committed) replayed through @ffl3k/core; every frame wait's machine state
 *  (VRAM, WRAM, OAM, HRAM; sound/stack/timing excluded, see IGNORE) and every screen must match.
 *  Skipped without the ROM or the trace. */
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace, replay, summarize, summarizeWaits } from "../src/index.js";

const TRACES: [string, string][] = [
  ["title1", "the title from its start (01:7C79): pictures, text, sprites, fade in, idle"],
  ["title2", "the title menu: cursor, buzzer, Select, key repeat"],
  ["newgame1", "New Game: fade out, the prologue's map load (door 3B -> map 05), window slide, text tile by tile"],
  ["newgame2", "New Game with A held through the prologue (a tile a frame), its pause, the name entry screen"],
  ["battle1", "the opening simulator battle: entities, monster pictures, slide, battle script up to the command menu"],
  ["battle2", "the opening battle's first round: Fight, every member's command and target, the actions"],
  ["battle3", "the opening battle to its end: every round with the default commands and targets"],
  ["newgame3", "the names: letters, cursor wrapping, B, Start (empty: buzzer), back a member; fade into the opening"],
  ["opening1", "after the battle: the opening scene's texts, scripted walks (normal handlers), map animation 1B"],
  ["opening2", "on through the scene: a map change with the wave fades (CA6B = 1, a raster at every line), a screen shake"],
  ["opening3", "the opening to its end: maps 0A/0B (tiles turned a quarter), the last scenes, up to the field loop"],
  ["field1", "the field loop 00:0265 (from field_start, the opening played to the field): idle, A facing nothing"],
  ["field2", "walking in the field: through the door into the ship, steps each way (scroll, new rows and columns, blocked steps)"],
  ["ship1", "the ship's cockpit (event 23): the console menu on stepping onto its cell, Depart refused, the cursor wrapping, B out"],
  ["ship2", "the cockpit's items: Engine and Warp (no units), Weapon (the Cannon set), Option; B out"],
  ["warp1", "up from the ship onto the platform in space, into the spiral: the warp to map 0A, a step down"],
  ["warp2", "the moving cells up to the platform with each button: back (slower, facing down), none, across (blocked: carried on), with (faster)"],
  ["world1", "through the warp, down map 0A's stairs onto the world map (map 02) by the temple, a few steps"],
  ["enc1", "a random encounter on the world map (00:10C2): two waves (Hooligans, F-Drake), A every 40 frames, won, the parts declined, the map back (00:1151)"],
  ["menu1", "the field menu (Start, 09:4000): its screen, the frame-tile animation (0B:7CDD), the cursor both ways, B back to the field"],
  ["menu2", "menu item 0 (09:4350, the items): the list, the cursor, the trash column, an item picked and put back"],
  ["menu3", "menu item 1 (09:435E, the abilities): a member chosen (09:413F), the list, back to the member choice"],
  ["menu4", "menu item 2 (09:4A4A): a member's 8 bytes C548-C54F, rows and columns (both ends), the top line, back to the member choice"],
  ["menu5", "menu item 3 (09:4377, the status): two members' status boxes"],
  ["menu6", "menu item 4 (09:439F, the equipment): the weapon taken off into the bag and put on again (00:2503, 0B:7124 off and on), swaps refused"],
  ["menu7", "menu item 5 (09:43B1, the auto-battle marks): members toggled (C500 bit 7)"],
  ["menu8", "menu item 6 (09:43F0, the save): the slots (SRAM, stash slot 3), B back, a slot saved, a used slot asked (no, then yes) and saved"],
  ["menu9", "menu item 6 left by B while the menu's rows are shown (hblank-paced copies, sync point 09:5044) on a 16th frame (the walking figures)"],
];

describe.skipIf(!haveRom())("FFL3 scenario parity", () => {
  for (const [name, what] of TRACES) {
    it.skipIf(!haveTrace(name))(`${name}: ${what}`, () => {
      const r = replay(name, { keepGoing: true });
      const info = `waits ${r.nWaits}/${r.trace.waitFrames.length} busy ${r.busy} tears ${r.tears} oamLate ${r.oamLate} oamTransient ${r.oamTransient} syncs ${r.nSyncs}/${r.trace.syncs.length} late ${r.lateSyncs} polls ${r.nPolls}/${r.trace.polls.length} late ${r.latePolls} points ${r.nPoints} late ${r.latePoints} rand ${r.nRand}/${r.trace.rand.length} works ${r.nWorks}/${r.trace.works.length} mismatch ${r.workMismatch} lineTears ${r.lineTears} (chunk ${r.chunkTears}) rasterTears ${r.rasterTears} sram ${r.trace.sram ? r.sramDiff.length : "-"}`;
      console.log(`${name}: ${info} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}\n${summarize(r.diffs)}`);
      expect(r.error).toBeUndefined();
      expect(r.nWaits).toBe(r.trace.waitFrames.length);
      expect(r.lateSyncs).toBe(0);
      expect(r.latePolls).toBe(0);
      expect(r.latePoints).toBe(0);
      expect(r.workMismatch).toBe(0);
      expect(r.waits).toEqual([]);
      expect(r.diffs).toEqual([]);
      expect(r.sramDiff).toEqual([]);
    });
  }
});
