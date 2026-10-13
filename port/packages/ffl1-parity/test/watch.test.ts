/** Ad-hoc: TRACE=name ADDRS=ff99,ffde FROM=400 TO=420 npx vitest run packages/ffl1-parity/test/watch.test.ts
 *  — per wait: expected/got of the given addresses. */
import { describe, it } from "vitest";
import { haveRom, haveTrace, replay } from "../src/index.js";

const name = process.env.TRACE ?? "";
const addrs = (process.env.ADDRS ?? "").split(",").filter(Boolean).map((s) => parseInt(s, 16));
const from = Number(process.env.FROM ?? 0), to = Number(process.env.TO ?? 1e9);
describe.skipIf(!name || !haveRom() || !haveTrace(name))("FFL1 watch", () => {
  it(name, () => {
    const lines: string[] = [];
    replay(name, {
      keepGoing: true, maxWaits: to + 1,
      watch: (i, f, exp, got) => {
        if (i < from || i > to) return;
        lines.push(`w${i} f${f}: ` + addrs.map((a) => `${a.toString(16)}=${exp[a - 0x8000]!.toString(16)}/${got[a - 0x8000]!.toString(16)}`).join(" "));
      },
    });
    console.log(lines.join("\n"));
  });
});
