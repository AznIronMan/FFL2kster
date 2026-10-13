/** splitTear (replay.ts): frames the original finished drawing during the display. */
import { describe, expect, it } from "vitest";
import { splitTear, lateLines } from "../src/replay.js";

const W = 160, H = 144;
const pic = (f: (x: number, y: number) => number) => {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x, y) & 3;
  return a;
};
const OLD = pic(() => 0), NEW = pic((x, y) => (x + y) % 3 + 1), WIN = pic((x) => (x >> 3) % 2 ? 3 : 1);
const split = (top: Uint8Array, bottom: Uint8Array, L: number) => pic((x, y) => (y < L ? top : bottom)[y * W + x]!);

describe("splitTear", () => {
  it("accepts old lines above L and the port's lines from L on", () => {
    expect(splitTear(split(OLD, NEW, 64), NEW, null, [OLD])).toBe(true);
  });
  it("accepts a pixel mix of old and new above L (writes in progress)", () => {
    const e = split(OLD, NEW, 16);
    for (let x = 0; x < 80; x++) e[2 * W + x] = NEW[2 * W + x]!;
    expect(splitTear(e, NEW, null, [OLD])).toBe(true);
  });
  it("rejects new lines above old lines (the wrong order)", () => {
    expect(splitTear(split(NEW, OLD, 64), NEW, null, [OLD])).toBe(false);
  });
  it("rejects a whole old frame and an exact frame", () => {
    expect(splitTear(OLD, NEW, null, [OLD])).toBe(false);
    expect(splitTear(NEW, NEW, null, [OLD])).toBe(false);
  });
  it("rejects pixels that are neither old nor new", () => {
    const e = split(OLD, NEW, 64);
    e[10 * W + 5] = 2; // OLD is 0, NEW (5+10)%3+1 = 1
    expect(splitTear(e, NEW, null, [OLD])).toBe(false);
    const f = split(OLD, NEW, 64);
    f[100 * W + 7] = 2; // NEW (7+100)%3+1 = 3, OLD 0
    expect(splitTear(f, NEW, null, [OLD])).toBe(false);
  });
  it("accepts latched-window lines only when the latched picture is given", () => {
    const e = split(OLD, WIN, 119);
    expect(splitTear(e, NEW, null, [OLD])).toBe(false);
    expect(splitTear(e, NEW, WIN, [OLD])).toBe(true);
  });
});

describe("lateLines", () => {
  it("accepts old lines down to a line, new below", () => {
    expect(lateLines(split(OLD, NEW, 7), [OLD, NEW])).toBe(true);
  });
  it("accepts the boundary line split at a pixel or mixed by tiles", () => {
    const e = split(OLD, NEW, 7);
    for (let x = 0; x < 50; x++) e[7 * W + x] = OLD[7 * W + x]!;
    expect(lateLines(e, [OLD, NEW])).toBe(true);
    const t = split(OLD, NEW, 7);
    for (let x = 16; x < 24; x++) t[7 * W + x] = OLD[7 * W + x]!;
    expect(lateLines(t, [OLD, NEW])).toBe(true);
  });
  it("rejects two mixed lines, new above old, old in the middle, stray pixels", () => {
    const two = split(OLD, NEW, 7);
    for (let x = 16; x < 24; x++) { two[7 * W + x] = OLD[7 * W + x]!; two[8 * W + x] = OLD[8 * W + x]!; }
    expect(lateLines(two, [OLD, NEW])).toBe(false);
    expect(lateLines(split(NEW, OLD, 7), [OLD, NEW])).toBe(false);
    const mid = pic((x, y) => (y >= 20 && y < 30 ? OLD : NEW)[y * W + x]!);
    expect(lateLines(mid, [OLD, NEW])).toBe(false);
    const stray = split(OLD, NEW, 7);
    stray[100 * W + 5] = 3 - NEW[100 * W + 5]!;
    expect(lateLines(stray, [OLD, NEW])).toBe(false);
  });
  it("accepts a frame wholly old (the writes landed after the display)", () => {
    expect(lateLines(OLD, [OLD, NEW])).toBe(true);
  });
});

describe("lateLines with intermediate stages", () => {
  const MID = pic((x, y) => (x * 7 + y) % 4);
  it("accepts old, then a stage of the step, then new, in line order", () => {
    const e = pic((x, y) => (y < 30 ? OLD : y < 90 ? MID : NEW)[y * W + x]!);
    expect(lateLines(e, [OLD, MID, NEW])).toBe(true);
    expect(lateLines(MID, [OLD, MID, NEW])).toBe(true);
  });
  it("rejects stages out of order", () => {
    const e = pic((x, y) => (y < 30 ? MID : y < 90 ? OLD : NEW)[y * W + x]!);
    expect(lateLines(e, [OLD, MID, NEW])).toBe(false);
  });
});
