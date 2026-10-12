/** Save/load parity: a game just saved to battery RAM (fm_saved: the end of fm_menu_save, made by
 *  `python3 tools/fm_sram.py fm_menu_save --save-state fm_saved`) is soft-reset (A+B+Select+Start)
 *  and continued from the title: boot, title with the cursor on Continue, the save-slot list
 *  (summaries read from battery RAM), loading slot 0 (00:675F checksum) and the field it was saved
 *  in. Recorded with
 *    python3 tools/trace_record.py ld_continue fm_saved "none:10,a+b+start+select:3,none:200,a:4,none:90,a:4,none:240,left:16,none:10,down:16,none:30"
 *    python3 tools/fm_sram.py ld_continue
 *  Tolerances (CPU time within a frame, as elsewhere):
 *  - the reset is taken in the frame tick (line 0), which on the hardware interrupts the field
 *    loop's iteration before its NPC wander roll (RNG stream counter C0A1, kept over a warm reset):
 *    C0A1 and the joypad history C771-C773 are re-phased at the reset wait;
 *  - the menu blink timer C7C6/C7C7 (BLINK in replay.ts) is re-phased at a wait where it is the
 *    only difference, and the frames drawn right after such a wait may show the cursor blink one
 *    frame off; those frames are allowed, all others must be identical.
 *  At most 6 re-phased waits. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace, replayField, summarizeWaits, IGNORE, TRACES, type Rig } from "../src/index.js";

const NAME = "ld_continue";

describe.skipIf(!haveRom() || !haveTrace(NAME) || !existsSync(resolve(TRACES, NAME, "sram_start.bin")))(`load trace ${NAME}`, () => {
  it("soft reset, title Continue, slot list, load slot 0, field: same screens and wait-point state", () => {
    let rig: Rig | undefined;
    const blink = new Set<number>();
    const { trace, diffs, waits, nWaits, rephased } = replayField(NAME, {
      ignore: IGNORE,
      rephase: (a) => a === 0xc0a1 || (a >= 0xc771 && a <= 0xc773),
      watch: (_i, f, exp, got) => { if (exp[0xc7c6 - 0x8000] !== got[0xc7c6 - 0x8000] || exp[0xc7c7 - 0x8000] !== got[0xc7c7 - 0x8000]) blink.add(f).add(f + 1); },
      setup: (r) => {
        rig = r;
        r.g.m.sram.set(new Uint8Array(readFileSync(resolve(TRACES, NAME, "sram_start.bin"))));
      },
    });
    expect(trace.meta.frames.length).toBeGreaterThan(500);
    expect(diffs.filter((d) => d.pixels && !blink.has(d.frame)).map((d) => `${d.frame}:${d.pixels}`)).toEqual([]);
    expect(nWaits).toBe(trace.waitFrames!.length);
    expect(summarizeWaits(waits)).toBe("");
    expect(rephased).toBeLessThanOrEqual(6);
    const last = trace.wram.subarray((trace.meta.frames.length - 1) * 0x2000);
    const party: string[] = [];
    for (let a = 0xc200; a < 0xc380; a++) if (rig!.g.m.rd(a) !== last[a - 0xc000]) party.push(a.toString(16));
    expect(party).toEqual([]);
  });
});
