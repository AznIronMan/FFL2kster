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
];

describe.skipIf(!haveRom())("FFL3 scenario parity", () => {
  for (const [name, what] of TRACES) {
    it.skipIf(!haveTrace(name))(`${name}: ${what}`, () => {
      const r = replay(name, { keepGoing: true });
      const info = `waits ${r.nWaits}/${r.trace.waitFrames.length} busy ${r.busy} tears ${r.tears} oamLate ${r.oamLate} oamTransient ${r.oamTransient} syncs ${r.nSyncs}/${r.trace.syncs.length} late ${r.lateSyncs} polls ${r.nPolls}/${r.trace.polls.length} late ${r.latePolls} points ${r.nPoints} late ${r.latePoints} rand ${r.nRand}/${r.trace.rand.length} works ${r.nWorks}/${r.trace.works.length} mismatch ${r.workMismatch} lineTears ${r.lineTears} (chunk ${r.chunkTears}) rasterTears ${r.rasterTears}`;
      console.log(`${name}: ${info} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}\n${summarize(r.diffs)}`);
      expect(r.error).toBeUndefined();
      expect(r.nWaits).toBe(r.trace.waitFrames.length);
      expect(r.lateSyncs).toBe(0);
      expect(r.latePolls).toBe(0);
      expect(r.latePoints).toBe(0);
      expect(r.workMismatch).toBe(0);
      expect(r.waits).toEqual([]);
      expect(r.diffs).toEqual([]);
    });
  }
});
