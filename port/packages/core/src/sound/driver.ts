/** The bank-0E sound driver (0E:4000-49F4), ported routine by routine.
 *
 *  All state lives at the original addresses, so driver RAM can be compared byte for byte with
 *  the original:
 *   - CB00 tempo accumulator, CB01 tempo; three channel blocks of 0x18 bytes at CB02 (song
 *     channel 0 → pulse 2, NR21-24), CB1A (song channel 1 → pulse 1, NR10-14; CB1A itself is the
 *     pulse-1 sound-effect frame counter) and CB32 (song channel 2 → wave, NR30-34). Block
 *     layout (offsets from CB02): +01 note ticks left, +02/03 sequence pointer, +04 vibrato step
 *     ticks, +05/06 vibrato list start, +07/08 vibrato pointer, +09 octave (×24, a byte offset
 *     into the frequency table), +0A duty (NRx1), +0B/0C note frequency (NRx3/NRx4 with the
 *     trigger bit), +0D loop counter 1, +0E default volume (NRx2 / NR32), +0F pitch nibble,
 *     +11 0xFF = channel ended, +12 envelope step ticks, +13/14 envelope list start, +15/16
 *     envelope pointer, +17 loop counter 2. Pulse 1 keeps its NR51 bits at CB2A; CB4A is the
 *     noise sound-effect frame counter.
 *   - CB62-CBC3: CB00-CB61 saved while a jingle (FFB1) plays; CBC4/C5 and CBC6/C7: the pulse-1
 *     and noise sound-effect stream pointers.
 *   - FFB0 song request, FFB1 jingle request (save the song, play, restore when it ends), FFB2
 *     sound-effect request, FFB3 current song, FFB4 modulation phase (0/1/2: one channel per
 *     frame), FFB5-B7 last note-tick counters per channel, FFB9 jingle active, FFBA/BB current
 *     waveform pointer, FFBC/BD sound-effect loop counters.
 *
 *  Sequence, envelope, vibrato, waveform and sound-effect data are read from the ROM at run time
 *  through the mapped bank (the driver always runs with bank 0E selected). Register writes go
 *  through `m.wr`, so `Memory.onSoundWrite` sees them in the original order.
 *
 *  Quirks of the original kept on purpose: the note-on code of both pulse channels loads the
 *  envelope pointer back into A instead of storing it (0E:42E3, 0E:4537 — harmless, 0E:47AC
 *  resets it); the end of song channel 1 silences pulse 2's NR23/NR24 (0E:4562); list loops
 *  (0E:4916) store two bytes after the loop pointer, which land in the ROM area (MBC writes). */
import type { Memory } from "../memory.js";

const NOTE_TICKS = 0x4244; // 13 tick counts by the note byte's high nibble
const FREQ = 0x419a; // NRx3/NRx4 words, 12 per octave
const OCTAVE_STEP = 0x47b5; // D8-DF relative octave steps (±24 per octave)
const SONGS = 0x49f5; // 3 channel pointers per song
const SFX_PULSE = 0x7ac5;
const SFX_NOISE = 0x7b37;
const BLOCK_INIT = 0x4175; // 0x18-byte channel block template

const rd16 = (m: Memory, a: number) => m.rd(a) | (m.rd(a + 1) << 8);
function wrPtr(m: Memory, a: number, v: number): void {
  m.wr(a, v & 0xff);
  m.wr(a + 1, (v >> 8) & 0xff);
}
const s8 = (v: number) => (v & 0x80 ? v - 0x100 : v);

// ---------------------------------------------------------------- entry points

/** 0E:4000 (→ 4006) — once per frame from the frame tick 00:16F9: handle jingle (FFB1), song
 *  (FFB0) and sound-effect (FFB2) requests, then advance the music and the sound effects. */
export function soundUpdate(m: Memory): void {
  if (m.rd(0xffb1)) {
    if (m.rd(0xffb9)) jingleCheckEnd(m);
    else jingleStart(m);
  } else if (m.rd(0xffb9)) {
    jingleRestore(m);
  } else {
    if (!m.rd(0xcb1a) && m.rd(0xffb0) !== m.rd(0xffb3)) songRequest(m, m.rd(0xffb0));
    const s = m.rd(0xffb2);
    if (s) sfxStart(m, s);
  }
  musicFrame(m);
  sfxFrame(m);
}

/** 0E:4003 (→ 4048) — sound on, all channels reset and silent, full volume to both outputs,
 *  FFB0-FFBF cleared. Also used to stop the music (song request 0). */
export function soundInit(m: Memory): void {
  m.wr(0xff26, 0xff);
  resetChannels(m);
  m.wr(0xcb13, 0xff);
  m.wr(0xcb2b, 0xff);
  m.wr(0xcb43, 0xff);
  m.wr(0xcb5b, 0xff);
  m.wr(0xff12, 0x10);
  m.wr(0xff17, 0x10);
  m.wr(0xff1c, 0x10);
  m.wr(0xff21, 0x10);
  silence(m);
  m.wr(0xcb1a, 0);
  m.wr(0xff24, 0x77);
  m.wr(0xff25, 0xff);
  for (let i = 0; i < 0x10; i++) m.wr(0xffb0 + i, 0);
}

/** 0E:4081 — CB00 = FF, tempo CB01 = 0x3C, the three channel blocks from the template 0E:4175. */
export function resetChannels(m: Memory): void {
  m.wr(0xcb00, 0xff);
  m.wr(0xcb01, 0x3c);
  let hl = 0xcb02;
  for (let b = 0; b < 3; b++) for (let i = 0; i < 0x18; i++) m.wr(hl++, m.rd(BLOCK_INIT + i));
}

/** 0E:409B — song request: FFB3 = song; 0 stops the music (full re-init). */
export function songRequest(m: Memory, song: number): void {
  m.wr(0xffb3, song);
  if (!song) {
    soundInit(m);
    return;
  }
  songStart(m, song);
}

/** 0E:40A4 — reset the channel blocks and load song n's three sequence pointers (0E:49F5). */
export function songStart(m: Memory, song: number): void {
  resetChannels(m);
  const a = (song - 1) & 0xff;
  let hl = SONGS + ((a * 6) & 0xff);
  for (const dst of [0xcb04, 0xcb05, 0xcb1c, 0xcb1d, 0xcb34, 0xcb35]) m.wr(dst, m.rd(hl++));
}

/** 0E:40CE — silence: sweep off, all note frequencies 0x7FF without trigger, noise off. */
export function silence(m: Memory): void {
  m.wr(0xff10, 0);
  m.wr(0xff13, 0xff);
  m.wr(0xff18, 0xff);
  m.wr(0xff1b, 0xff);
  m.wr(0xff1d, 0xff);
  m.wr(0xff14, 0x07);
  m.wr(0xff19, 0x07);
  m.wr(0xff1e, 0x07);
  m.wr(0xff21, 0);
  m.wr(0xff23, 0x80);
}

/** 0E:40EB — jingle start: silence, cancel sound effects, save CB00-CB61 to CB62, start song
 *  FFB1, FFB9 = 1. */
export function jingleStart(m: Memory): void {
  silence(m);
  m.wr(0xcb1a, 0);
  m.wr(0xcb4a, 0);
  for (let i = 0; i < 0x62; i++) m.wr(0xcb62 + i, m.rd(0xcb00 + i));
  songStart(m, m.rd(0xffb1));
  m.wr(0xffb9, 1);
}

/** 0E:410D — while the jingle plays: once all three channels have ended, restore (0E:411D). */
export function jingleCheckEnd(m: Memory): void {
  if ((m.rd(0xcb13) & m.rd(0xcb2b) & m.rd(0xcb43)) !== 0xff) return;
  jingleRestore(m);
}

/** 0E:411D — restore the saved song: silence, copy CB62 back to CB00-CB61, clear FFB1/FFB9,
 *  restore pulse 2 duty/volume (retriggered), reload the waveform and restore pulse 1. */
export function jingleRestore(m: Memory): void {
  silence(m);
  for (let i = 0; i < 0x62; i++) m.wr(0xcb00 + i, m.rd(0xcb62 + i));
  m.wr(0xffb1, 0);
  m.wr(0xffb9, 0);
  m.wr(0xff16, m.rd(0xcb0c));
  m.wr(0xff17, m.rd(0xcb10));
  m.wr(0xff19, 0x87);
  loadWave(m, m.rd(0xffba) | (m.rd(0xffbb) << 8));
  pulse1Restore(m);
}

/** 0E:414A — give pulse 1 back to the music: sweep off, duty CB24, volume CB28, retrigger,
 *  NR51 pulse-1 bits from CB2A. */
export function pulse1Restore(m: Memory): void {
  m.wr(0xff10, 0);
  m.wr(0xff11, m.rd(0xcb24));
  m.wr(0xff12, m.rd(0xcb28));
  m.wr(0xff13, 0xff);
  m.wr(0xff14, 0x87);
  m.wr(0xff25, (m.rd(0xff25) & 0xee) | m.rd(0xcb2a));
}

/** 0E:416B — noise off after its sound effect. */
export function noiseOff(m: Memory): void {
  m.wr(0xff21, 0);
  m.wr(0xff22, 0);
  m.wr(0xff23, 0x80);
}

// ---------------------------------------------------------------- music

/** 0E:4251 — CB00 += tempo; on carry two sequence ticks. Then one channel's modulation lists
 *  (vibrato/envelope) per frame, rotating with FFB4. */
export function musicFrame(m: Memory): void {
  const t = m.rd(0xcb00) + m.rd(0xcb01);
  m.wr(0xcb00, t);
  if (t > 0xff) {
    musicTick(m);
    musicTick(m);
  }
  let p = m.rd(0xffb4) + 1;
  if (p === 3) p = 0;
  m.wr(0xffb4, p);
  if (m.rd(0xffb4) === 0) modPulse2(m);
  if (m.rd(0xffb4) === 1) modPulse1(m);
  if (m.rd(0xffb4) === 2) modWave(m);
}

/** 0E:4281 — one sequence tick of the three channels (falls through 0E:44CC and 0E:464C). */
export function musicTick(m: Memory): void {
  // 0E:4281 — song channel 0 (pulse 2)
  if (m.rd(0xcb13) !== 0xff) {
    const a = (m.rd(0xcb03) - 1) & 0xff;
    m.wr(0xcb03, a);
    m.wr(0xffb5, a);
    if (a === 0) parsePulse2(m);
  }
  // 0E:44CC — song channel 1 (pulse 1)
  if (m.rd(0xcb2b) !== 0xff) {
    const a = (m.rd(0xcb1b) - 1) & 0xff;
    m.wr(0xcb1b, a);
    m.wr(0xffb6, a);
    if (a === 0) parsePulse1(m);
  }
  // 0E:464C — song channel 2 (wave)
  if (m.rd(0xcb43) !== 0xff) {
    const a = (m.rd(0xcb33) - 1) & 0xff;
    m.wr(0xcb33, a);
    m.wr(0xffb7, a);
    if (a === 0) parseWave(m);
  }
}

/** 0E:47BD / 47C9 / 47CE — next sequence byte of the channel whose pointer is at `ptr`. */
export function seqByte(m: Memory, ptr: number): number {
  const de = rd16(m, ptr);
  const a = m.rd(de);
  wrPtr(m, ptr, de + 1);
  return a;
}

/** 0E:47AC — restart a modulation list: [hl] = 1, current pointer [hl+3/4] = start [hl+1/2]. */
export function listRestart(m: Memory, hl: number): void {
  m.wr(hl, 1);
  const a = m.rd(hl + 1), e = m.rd(hl + 2);
  m.wr(hl + 3, a);
  m.wr(hl + 4, e);
}

/** D0-DF on any channel: D0-D7 set octave (×24), D8-DF step it by 0E:47B5. */
function octave(m: Memory, at: number, b: number): void {
  if (b & 0x08) m.wr(at, m.rd(at) + m.rd(OCTAVE_STEP + (b & 7)));
  else m.wr(at, (b & 7) * 24);
}

/** Duration nibble → ticks (0E:4244). */
const noteTicks = (m: Memory, b: number) => m.rd(NOTE_TICKS + (b >> 4));

/** 0E:4295 — song channel 0 (pulse 2) sequence: commands until a note, rest, tie or end. */
export function parsePulse2(m: Memory): void {
  for (;;) {
    const b = seqByte(m, 0xcb04);
    if (b < 0xd0) {
      m.wr(0xcb03, noteTicks(m, b));
      const p = b & 0x0f;
      m.wr(0xcb11, p);
      if (p === 0x0e) return;
      if (p === 0x0f) {
        m.wr(0xff18, 0xff);
        m.wr(0xff19, 0x07);
        return;
      }
      const hl = FREQ + ((p * 2 + m.rd(0xcb0b)) & 0xff);
      const env = rd16(m, 0xcb15);
      m.wr(0xcb14, m.rd(env));
      m.wr(0xff17, m.rd(env + 1));
      m.rd(0xcb17); // 0E:42E3: loads instead of stores (no effect)
      m.rd(0xcb18);
      const lo = m.rd(hl), hi = m.rd(hl + 1);
      m.wr(0xff18, lo);
      m.wr(0xcb0d, lo);
      m.wr(0xff19, hi);
      m.wr(0xcb0e, hi);
      listRestart(m, 0xcb06);
      listRestart(m, 0xcb14);
      return;
    }
    if (b === 0xff) {
      m.wr(0xcb13, 0xff);
      m.wr(0xff18, 0xff);
      m.wr(0xff19, 0x07);
      return;
    }
    if (b < 0xe0) octave(m, 0xcb0b, b);
    else cmdPulse2(m, b);
  }
}

/** 0E:44E0 — song channel 1 (pulse 1) sequence; notes are not played (but still timed) while a
 *  sound effect owns pulse 1 (CB1A != 0). */
export function parsePulse1(m: Memory): void {
  for (;;) {
    const b = seqByte(m, 0xcb1c);
    if (b < 0xd0) {
      m.wr(0xcb1b, noteTicks(m, b));
      const p = b & 0x0f;
      m.wr(0xcb29, p);
      if (p === 0x0e) return;
      if (m.rd(0xcb1a)) return;
      if (p === 0x0f) {
        m.wr(0xff13, 0xff);
        m.wr(0xff14, 0x07);
        return;
      }
      const hl = FREQ + ((p * 2 + m.rd(0xcb23)) & 0xff);
      const env = rd16(m, 0xcb2d);
      m.wr(0xcb2c, m.rd(env));
      m.wr(0xff12, m.rd(env + 1));
      m.rd(0xcb2f); // 0E:4537: loads instead of stores (no effect)
      m.rd(0xcb30);
      const lo = m.rd(hl), hi = m.rd(hl + 1);
      m.wr(0xff13, lo);
      m.wr(0xcb25, lo);
      m.wr(0xff14, hi);
      m.wr(0xcb26, hi);
      listRestart(m, 0xcb1e);
      listRestart(m, 0xcb2c);
      return;
    }
    if (b === 0xff) {
      m.wr(0xcb2b, 0xff);
      m.wr(0xff18, 0xff); // sic: pulse 2's registers
      m.wr(0xff19, 0x07);
      return;
    }
    if (b < 0xe0) octave(m, 0xcb23, b);
    else cmdPulse1(m, b);
  }
}

/** 0E:4660 — song channel 2 (wave) sequence. A note sets NR32 from CB40 and the frequency
 *  without retrigger; a rest mutes NR32. */
export function parseWave(m: Memory): void {
  for (;;) {
    const b = seqByte(m, 0xcb34);
    if (b < 0xd0) {
      m.wr(0xcb33, noteTicks(m, b));
      const p = b & 0x0f;
      m.wr(0xcb41, p);
      if (p === 0x0e) return;
      if (p === 0x0f) {
        m.wr(0xff1c, 0);
        return;
      }
      const hl = FREQ + ((p * 2 + m.rd(0xcb3b)) & 0xff);
      m.wr(0xff1c, m.rd(0xcb40));
      const lo = m.rd(hl);
      m.wr(0xff1d, lo);
      m.wr(0xcb3d, lo);
      const hi = m.rd(hl + 1) & 7;
      m.wr(0xff1e, hi);
      m.wr(0xcb3e, hi);
      listRestart(m, 0xcb36);
      return;
    }
    if (b === 0xff) {
      m.wr(0xcb43, 0xff);
      m.wr(0xff1d, 0xff);
      m.wr(0xff1e, 0x07);
      return;
    }
    if (b < 0xe0) octave(m, 0xcb3b, b);
    else cmdWave(m, b);
  }
}

// ---------------------------------------------------------------- sequence commands

/** Command dispatch of song channel 0 (table 0E:4358). */
function cmdPulse2(m: Memory, b: number): void {
  switch (b & 0x0f) {
    case 0x0: return setEnvelope(m, 0xcb04, 0xcb15, 0xcb17);
    case 0x1: return seqJump(m, 0xcb04);
    case 0x2: return seqLoop(m, 0xcb04, 0xcb0f);
    case 0x3: return m.wr(0xcb0f, seqByte(m, 0xcb04)); // 0E:4477
    case 0x4: return setVibrato(m, 0xcb04, 0xcb07);
    case 0x5: return dutyPulse2(m);
    case 0x6: return panPulse2(m);
    case 0x7: return m.wr(0xcb01, seqByte(m, 0xcb04)); // 0E:44C5 tempo
    case 0x8: return; // 0E:4357
    case 0x9: return seqLoop(m, 0xcb04, 0xcb19);
    case 0xa: return m.wr(0xcb19, seqByte(m, 0xcb04)); // 0E:447E
    case 0xb: return seqJumpIf(m, 0xcb04, 0xcb0f);
  }
  throw new Error(`sound: no command ${b.toString(16)} on channel 0`);
}

/** Command dispatch of song channel 1 (table 0E:45AB). */
function cmdPulse1(m: Memory, b: number): void {
  switch (b & 0x0f) {
    case 0x0: return setEnvelopeStart(m);
    case 0x1: return seqJump(m, 0xcb1c);
    case 0x2: return seqLoop(m, 0xcb1c, 0xcb27);
    case 0x3: return m.wr(0xcb27, seqByte(m, 0xcb1c)); // 0E:45EE
    case 0x4: return setVibrato(m, 0xcb1c, 0xcb1f);
    case 0x5: return dutyPulse1(m);
    case 0x6: return panPulse1(m);
    case 0x7: case 0x8: return; // 0E:4357
    case 0x9: return seqLoop(m, 0xcb1c, 0xcb31);
    case 0xa: return m.wr(0xcb31, seqByte(m, 0xcb1c)); // 0E:45F5
    case 0xb: return seqJumpIf(m, 0xcb1c, 0xcb27);
  }
  throw new Error(`sound: no command ${b.toString(16)} on channel 1`);
}

/** Command dispatch of song channel 2 (table 0E:4706). */
function cmdWave(m: Memory, b: number): void {
  switch (b & 0x0f) {
    case 0x0: return waveVolume(m);
    case 0x1: return seqJump(m, 0xcb34);
    case 0x2: return seqLoop(m, 0xcb34, 0xcb3f);
    case 0x3: return m.wr(0xcb3f, seqByte(m, 0xcb34)); // 0E:4737
    case 0x4: return setVibrato(m, 0xcb34, 0xcb37);
    case 0x5: case 0x7: return; // 0E:4357
    case 0x6: return panWave(m);
    case 0x8: return setWaveform(m);
    case 0x9: return seqLoop(m, 0xcb34, 0xcb49);
    case 0xa: return m.wr(0xcb49, seqByte(m, 0xcb34)); // 0E:473E
    case 0xb: return seqJumpIf(m, 0xcb34, 0xcb3f);
  }
  throw new Error(`sound: no command ${b.toString(16)} on channel 2`);
}

/** 0E:4370 — E0 (channel 0): envelope list; start and current pointer. */
function setEnvelope(m: Memory, ptr: number, start: number, cur: number): void {
  const de = rd16(m, ptr);
  const c = m.rd(de), a = m.rd(de + 1);
  m.wr(start + 1, a);
  m.wr(cur + 1, a);
  m.wr(start, c);
  m.wr(cur, c);
  wrPtr(m, ptr, de + 2);
}

/** 0E:45C3 — E0 (channel 1): envelope list start only. */
function setEnvelopeStart(m: Memory): void {
  const de = rd16(m, 0xcb1c);
  const c = m.rd(de), a = m.rd(de + 1);
  m.wr(0xcb2e, a);
  m.wr(0xcb2d, c);
  wrPtr(m, 0xcb1c, de + 2);
}

/** 0E:4391 / 45DE / 4727 — E1: jump. */
function seqJump(m: Memory, ptr: number): void {
  const de = rd16(m, ptr);
  const lo = m.rd(de);
  m.wr(ptr, lo);
  m.wr(ptr + 1, m.rd(de + 1));
}

/** 0E:43A1 / 43B1 / 43C1 (E2) and 43D1 / 43E1 / 43F1 (E9), tail 0E:4401/440A — decrement a
 *  loop counter; jump while it is not zero, else skip the address. */
function seqLoop(m: Memory, ptr: number, ctr: number): void {
  const de = rd16(m, ptr);
  const c = m.rd(de), b = m.rd(de + 1);
  const n = (m.rd(ctr) - 1) & 0xff;
  m.wr(ctr, n);
  if (n) {
    m.wr(ptr + 1, b);
    m.wr(ptr, c);
  } else {
    m.wr(ptr + 1, ((de + 2) >> 8) & 0xff);
    m.wr(ptr, (de + 2) & 0xff);
  }
}

/** 0E:4414 / 4435 / 4456 — EB n addr: jump if loop counter 1 == n. */
function seqJumpIf(m: Memory, ptr: number, ctr: number): void {
  const c = seqByte(m, ptr);
  let hl = rd16(m, ptr);
  const de = m.rd(hl) | (m.rd(hl + 1) << 8);
  hl += 2;
  if (m.rd(ctr) === c) hl = de;
  wrPtr(m, ptr, hl);
}

/** 0E:4485 / 45FC / 4745 — E4: vibrato list (start at `start`, current at start+2). */
function setVibrato(m: Memory, ptr: number, start: number): void {
  const de = rd16(m, ptr);
  const c = m.rd(de), a = m.rd(de + 1);
  m.wr(start + 1, a);
  m.wr(start + 3, a);
  m.wr(start, c);
  m.wr(start + 2, c);
  wrPtr(m, ptr, de + 2);
}

/** 0E:44A6 — E5 (channel 0): NR21 duty. */
function dutyPulse2(m: Memory): void {
  const a = seqByte(m, 0xcb04);
  m.wr(0xff16, a);
  m.wr(0xcb0c, a);
}

/** 0E:461D — E5 (channel 1): duty CB24; NR11 unless a sound effect owns pulse 1. */
function dutyPulse1(m: Memory): void {
  const a = seqByte(m, 0xcb1c);
  m.wr(0xcb24, a);
  if (m.rd(0xcb1a)) return;
  m.wr(0xff11, a);
}

/** 0E:44AF — E6 (channel 0): NR51 pulse-2 bits from 0E:4648. */
function panPulse2(m: Memory): void {
  const a = seqByte(m, 0xcb04);
  m.wr(0xff25, (m.rd(0xff25) & 0xdd) | m.rd(0x4648 + a));
}

/** 0E:462D — E6 (channel 1): NR51 pulse-1 bits from 0E:44C1 into CB2A; applied unless a sound
 *  effect owns pulse 1. */
function panPulse1(m: Memory): void {
  const a = seqByte(m, 0xcb1c);
  const v = m.rd(0x44c1 + a);
  m.wr(0xcb2a, v);
  if (m.rd(0xcb1a)) return;
  m.wr(0xff25, (m.rd(0xff25) & 0xee) | v);
}

/** 0E:4766 — E6 (channel 2): NR51 wave bits from 0E:4778. */
function panWave(m: Memory): void {
  const a = seqByte(m, 0xcb34);
  m.wr(0xff25, (m.rd(0xff25) & 0xbb) | m.rd(0x4778 + a));
}

/** 0E:471E — E0 (channel 2): wave volume CB40 and NR32. */
function waveVolume(m: Memory): void {
  const a = seqByte(m, 0xcb34);
  m.wr(0xcb40, a);
  m.wr(0xff1c, a);
}

/** 0E:477C — E8: waveform pointer (kept in FFBA/BB for the jingle restore), then load it. */
function setWaveform(m: Memory): void {
  const de = rd16(m, 0xcb34);
  const c = m.rd(de);
  m.wr(0xffba, c);
  const b = m.rd(de + 1);
  m.wr(0xffbb, b);
  m.wr(0xcb35, ((de + 2) >> 8) & 0xff);
  m.wr(0xcb34, (de + 2) & 0xff);
  loadWave(m, c | (b << 8));
}

/** 0E:4791 — wave channel off, 16 bytes to wave RAM FF30-FF3F, on, NR32 = 0, retrigger. */
export function loadWave(m: Memory, hl: number): void {
  m.wr(0xff1a, 0);
  for (let i = 0; i < 0x10; i++) m.wr(0xff30 + i, m.rd((hl + i) & 0xffff));
  m.wr(0xff1a, 0x80);
  m.wr(0xff1c, 0);
  m.wr(0xff1e, 0x87);
}

// ---------------------------------------------------------------- modulation lists

/** 0E:4916 — list loop: after a 0 entry, read the loop pointer (and store it two bytes further
 *  on, as the original does) and return the first byte at the target. hl points after the 0. */
function listLoop(m: Memory, hl: number): [number, number] {
  const e = m.rd(hl);
  const a = m.rd(hl + 1);
  m.wr(hl + 2, e);
  m.wr(hl + 3, a);
  const t = (a << 8) | e;
  return [m.rd(t), (t + 1) & 0xffff];
}

/** Shared body of 0E:47D3 / 484D / 48C7: vibrato step and (pulse) envelope step. */
function modulate(
  m: Memory, gate: number, ended: number, ticks: number, pitch: number, blk: number,
  nrLo: number, nrHi: number, nrVol: number | null,
): void {
  // blk: vibrato ticks at blk, pointer blk+3/4, note freq blk+7/8, envelope ticks blk+0x0E, pointer +0x11/12
  if (m.rd(gate) | m.rd(ended)) return;
  if (!m.rd(ticks)) return;
  if (m.rd(pitch) === 0x0f) return;
  const v = (m.rd(blk) - 1) & 0xff;
  m.wr(blk, v);
  if (v === 0) {
    let hl = rd16(m, blk + 3);
    let a = m.rd(hl);
    hl++;
    if (!a) [a, hl] = listLoop(m, hl);
    m.wr(blk, a);
    const e = m.rd(hl);
    hl++;
    wrPtr(m, blk + 3, hl);
    const f = (rd16(m, blk + 7) + s8(e)) & 0xffff;
    m.wr(nrLo, f & 0xff);
    m.wr(nrHi, (f >> 8) & 7);
  }
  if (nrVol === null) return;
  const envT = blk + 0x0e;
  let a = m.rd(envT);
  if (a === 0xff) return;
  a = (a - 1) & 0xff;
  m.wr(envT, a);
  if (a) return;
  let hl = rd16(m, envT + 3);
  a = m.rd(hl);
  hl++;
  if (!a) [a, hl] = listLoop(m, hl);
  m.wr(envT, a);
  m.wr(nrVol, m.rd(hl));
  hl++;
  m.wr(nrHi, m.rd(blk + 8));
  wrPtr(m, envT + 3, hl);
}

/** 0E:47D3 — modulation of song channel 0 (pulse 2): vibrato → NR23/24, envelope → NR22 and
 *  retrigger. Skipped right after a new note (FFB5 = 0), on rests and when ended. */
export function modPulse2(m: Memory): void {
  modulate(m, 0xcb02, 0xcb13, 0xffb5, 0xcb11, 0xcb06, 0xff18, 0xff19, 0xff17);
}

/** 0E:484D — modulation of song channel 1 (pulse 1); not while a sound effect owns it. */
export function modPulse1(m: Memory): void {
  modulate(m, 0xcb1a, 0xcb2b, 0xffb6, 0xcb29, 0xcb1e, 0xff13, 0xff14, 0xff12);
}

/** 0E:48C7 — modulation of song channel 2 (wave): vibrato only. */
export function modWave(m: Memory): void {
  modulate(m, 0xcb32, 0xcb43, 0xffb7, 0xcb41, 0xcb36, 0xff1d, 0xff1e, null);
}

// ---------------------------------------------------------------- sound effects

/** 0E:4920 — start sound effect n: stream pointers from 0E:7AC5 / 0E:7B37, both streams due
 *  next frame (CB1A = CB4A = 1), FFB2 = 0. */
export function sfxStart(m: Memory, n: number): void {
  const e = ((n - 1) * 2) & 0xff;
  m.wr(0xcbc4, m.rd(SFX_PULSE + e));
  m.wr(0xcbc5, m.rd(SFX_PULSE + e + 1));
  m.wr(0xcbc6, m.rd(SFX_NOISE + e));
  m.wr(0xcbc7, m.rd(SFX_NOISE + e + 1));
  m.wr(0xcb1a, 1);
  m.wr(0xcb4a, 1);
  m.wr(0xffb2, 0);
}

/** 0E:4949 — advance the sound-effect streams: pulse 1 steps [frames, NR10-NR14], noise steps
 *  [frames, NR42, NR43] (NR44 = 0x80); 0 ends (pulse 1 back to the music / noise off),
 *  0xF0|k sets a loop count, 0xEF lo hi loops. */
export function sfxFrame(m: Memory): void {
  let a = m.rd(0xcb1a);
  if (a) {
    a = (a - 1) & 0xff;
    m.wr(0xcb1a, a);
    if (!a) sfxPulseStep(m);
  }
  a = m.rd(0xcb4a);
  if (a) {
    a = (a - 1) & 0xff;
    m.wr(0xcb4a, a);
    if (!a) sfxNoiseStep(m);
  }
}

/** 0E:4956 — next pulse-1 sound-effect step. */
function sfxPulseStep(m: Memory): void {
  let hl = rd16(m, 0xcbc4);
  for (;;) {
    const a = m.rd(hl++);
    m.wr(0xcb1a, a);
    if (!a) {
      pulse1Restore(m);
      return;
    }
    if (a === 0xef) {
      const c = m.rd(hl++), b = m.rd(hl++);
      const n = (m.rd(0xffbc) - 1) & 0xff;
      m.wr(0xffbc, n);
      if (n) hl = c | (b << 8);
      continue;
    }
    if (a >= 0xf0) {
      m.wr(0xffbc, a & 0x0f);
      continue;
    }
    for (let r = 0x10; r < 0x15; r++) m.wr(0xff00 | r, m.rd(hl++));
    m.wr(0xff25, m.rd(0xff25) | 0x11);
    wrPtr(m, 0xcbc4, hl);
    return;
  }
}

/** 0E:49AB — next noise sound-effect step. */
function sfxNoiseStep(m: Memory): void {
  let hl = rd16(m, 0xcbc6);
  for (;;) {
    const a = m.rd(hl++);
    m.wr(0xcb4a, a);
    if (!a) {
      noiseOff(m);
      return;
    }
    if (a === 0xef) {
      const c = m.rd(hl++), b = m.rd(hl++);
      const n = (m.rd(0xffbd) - 1) & 0xff;
      m.wr(0xffbd, n);
      if (n) hl = c | (b << 8);
      continue;
    }
    if (a >= 0xf0) {
      m.wr(0xffbd, a & 0x0f);
      continue;
    }
    m.wr(0xff21, m.rd(hl++));
    m.wr(0xff22, m.rd(hl++));
    m.wr(0xff23, 0x80);
    m.wr(0xff25, m.rd(0xff25) | 0x88);
    wrPtr(m, 0xcbc6, hl);
    return;
  }
}
