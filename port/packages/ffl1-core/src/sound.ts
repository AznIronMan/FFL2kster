/** Legend I sound driver (bank 07), ported routine by routine over the original RAM (CE00-CEFF,
 *  FFE0-FFEE) and the APU registers (FF10-FF26), so its state compares byte for byte with the
 *  emulator. Music: three channels (pulse 1, pulse 2, wave) of 32 bytes at CE00 / CE20 / CE40;
 *  sound effects on pulse 1 (borrowed: CE00 bit 0) and noise; jingles save the music to CE60.
 *
 *  Channel record (+n from its base):
 *    00 flags (bit 7 ended, bit 0 pulse 1 owned by a sound effect)   01 ticks left in the note
 *    02/03 sequence pointer   04 note to start (0F none)   05 octave   06 loop counter
 *    09/0A frequency (FF FF: rest)   0B volume (E1-EF)   0C/0D/0E envelope: table, index, ticks
 *    0F/10/11 pitch slide   12/13/14 duty   15/16/17 panning   18 NRx1 (F5)   19 NRx2
 *    1A/1B last frequency written   1C panning bits
 *  HRAM: FFE0 song requested, FFE1 song playing, FFE2 jingle request, FFE3 jingle playing,
 *  FFE4 sound effect request, FFE6 note being started, FFE7/E8 channel base, FFE9 channel,
 *  FFEA tempo, FFEB/EC pulse effect pointer, FFED/EE noise effect pointer. */
import type { Game } from "./game.js";

const ff = (r: number) => 0xff00 | r;

export class SoundDriver {
  constructor(readonly g: Game) {}

  private get m() { return this.g.m; }
  private hr(a: number): number { return this.m.hram[a - 0xff80]!; }
  private hw(a: number, v: number): void { this.m.hram[a - 0xff80] = v & 0xff; }
  private rd(a: number): number { return this.m.rd(a & 0xffff); }
  private wr(a: number, v: number): void { this.m.wr(a & 0xffff, v & 0xff); }
  private word(a: number): number { return this.rd(a) | (this.rd(a + 1) << 8); }
  /** 07:45B5 — the current channel's field n. */
  private ch(n: number): number { return ((this.hr(0xffe8) << 8) | this.hr(0xffe7)) + n & 0xffff; }

  /** 07:4006 — reset: NR52 on, the channels' volume and NR51 cleared, no song (FFE0 = FFE1 = 0),
   *  the three music channels ended, tempo FF. */
  init(): void {
    this.wr(ff(0x26), 0x8f);
    for (const r of [0x10, 0x12, 0x17, 0x1c, 0x21, 0x25]) this.wr(ff(r), 0);
    this.hw(0xffe0, 0);
    this.hw(0xffe1, 0);
    this.wr(0xce00, 0xff);
    this.wr(0xce20, 0xff);
    this.wr(0xce40, 0xff);
    this.hw(0xffea, 0xff);
  }

  /** 07:4030 — once per frame: jingles (07:6A44), then a tick for every 3C the tempo adds up
   *  to in CEC2 (8-bit), each tick the output side (07:40CD) then the sequences (07:44BC); then
   *  the sound effects (07:6AA8). */
  update(): void {
    this.jingles();
    let a = (this.rd(0xcec2) + this.hr(0xffea)) & 0xff;
    for (;;) {
      this.wr(0xcec2, a);
      if (a < 0x3c) break;
      a -= 0x3c;
      this.output();
      this.sequences();
    }
    this.effects();
  }

  /** 07:6A44 — a jingle (FFE2) saves the music (CE00-CE5F to CE60, tempo and song to CEC0/1)
   *  and plays; when all three channels have ended the music comes back. */
  private jingles(): void {
    if (this.hr(0xffe2)) {
      if (!this.hr(0xffe3)) {
        this.wr(0xcec0, this.hr(0xffea));
        this.wr(0xcec1, this.hr(0xffe0));
        this.hw(0xffe3, 1);
        for (let i = 0; i < 0x60; i++) this.wr(0xce60 + i, this.rd(0xce00 + i));
      }
      this.hw(0xffe0, this.hr(0xffe2));
      this.hw(0xffe2, 0);
      this.hw(0xffe1, 0);
    }
    if (!this.hr(0xffe3)) return;
    if (!(this.rd(0xce00) & this.rd(0xce20) & this.rd(0xce40) & 0x80)) return;
    for (let i = 0; i < 0x60; i++) this.wr(0xce00 + i, this.rd(0xce60 + i));
    this.hw(0xffea, this.rd(0xcec0));
    this.hw(0xffe0, this.rd(0xcec1));
    this.hw(0xffe1, this.rd(0xcec1));
    this.hw(0xffe3, 0);
  }

  /** 07:4059 — song e: CE00-CE5F cleared, the channels' sequence pointers from 07:462F + 6e,
   *  every counter 1, no note; NR52 on, NR30 = FF, NR50 = 77. */
  private start(e: number): void {
    this.hw(0xffe1, e);
    for (let i = 0; i < 0x60; i++) this.wr(0xce00 + i, 0);
    const t = 0x462f + ((e * 6) & 0xff);
    for (let c = 0; c < 3; c++) {
      const b = 0xce00 + 0x20 * c;
      this.wr(b + 2, this.rd(t + 2 * c));
      this.wr(b + 3, this.rd(t + 2 * c + 1));
      this.wr(b + 4, 0x0f);
      for (const n of [0x01, 0x0e, 0x14, 0x17]) this.wr(b + n, 1);
      this.wr(b, 0);
    }
    this.wr(ff(0x26), 0x8f);
    this.wr(ff(0x1a), 0xff);
    this.wr(ff(0x24), 0x77);
  }

  /** 07:40CD — a new song when FFE0 differs from FFE1; NR10 = 0 unless an effect owns pulse 1;
   *  each channel's output (07:40FC). */
  private output(): void {
    const e = this.hr(0xffe0);
    if (this.hr(0xffe1) !== e) this.start(e);
    if (!(this.rd(0xce00) & 1)) this.wr(ff(0x10), 0);
    for (let c = 0; c < 3; c++) this.channelOut(c);
  }

  /** 07:43D9 — the channel may write its registers (pulse 1: not while an effect owns it). */
  private free(): boolean {
    return !(this.rd(this.ch(0)) & 1);
  }

  /** 07:40FC — a channel's output tick: a new note's duration (07:4403), the note's frequency
   *  (07:4134), then envelope, pitch, duty and panning. */
  private channelOut(c: number): void {
    const base = 0xce00 + 0x20 * c;
    this.hw(0xffe9, c);
    this.hw(0xffe7, base & 0xff);
    this.hw(0xffe8, base >> 8);
    const a = this.rd(this.ch(4));
    this.hw(0xffe6, a);
    if (a !== 0x0f) this.wr(this.ch(1), this.rd(0x4403 + (a & 0x0f)));
    if (this.rd(base) & 0x80) {
      this.wr(this.ch(4), 0x0f);
      return;
    }
    this.note();
    this.envelope();
  }

  /** 07:4134 — the note in FFE6: a rest (C0-CF) sets the frequency FFFF; D0 and above are no
   *  note; else frequency = 07:4412[pitch + 12 * octave], and the envelope restarts. */
  private note(): void {
    const a = this.hr(0xffe6);
    if (a === 0x0f) return;
    if (a >= 0xd0) { this.hw(0xffe6, 0x0f); return; }
    if (a >= 0xc0) {
      this.wr(this.ch(9), 0xff);
      this.wr(this.ch(10), 0xff);
      return;
    }
    const bc = (a >> 3) & 0x1e;
    const de = ((((this.rd(this.ch(5)) * 4) & 0xff) * 3 & 0xff) * 2) & 0xff;
    const f = this.word((0x4412 + bc + de) & 0xffff);
    this.wr(this.ch(9), f & 0xff);
    this.wr(this.ch(10), f >> 8);
    this.wr(this.ch(0x0d), 0);
    this.wr(this.ch(0x0e), 1);
  }

  /** A table walk shared by the envelope, pitch, duty and panning: the list at word[table +
   *  2 * [sel]], position [pos] (advanced by step); a 00 entry jumps to the position after it
   *  and the counter restarts at 1. Returns the entry's address. */
  private walk(table: number, sel: number, pos: number, cnt: number, step: number): number {
    for (;;) {
      const de = this.word((table + 2 * this.rd(this.ch(sel))) & 0xffff);
      const p = this.rd(this.ch(pos));
      this.wr(this.ch(pos), p + step);
      const at = (de + p) & 0xffff;
      const a = this.rd(at);
      if (a !== 0) return at;
      this.wr(this.ch(pos), this.rd(at + 1));
      this.wr(this.ch(cnt), 1);
    }
  }

  /** 07:418B — envelope (07:6870: duration, then volume step << 4 | NRx2 low nibble), volume =
   *  step x [0B] + 10 (wave: 07:43EA level); a rest silences the channel (NRx2 = 08, pulse:
   *  NRx4 = 80) and skips to the panning. */
  private envelope(): void {
    const c = this.hr(0xffe9);
    if (this.rd(this.ch(0x0a)) === 0xff) {
      const r = this.rd(0x43fd + c);
      this.wr(ff(r), 0x08);
      if (c !== 2) this.wr(ff(r + 2), 0x80);
      this.panning();
      return;
    }
    this.wr(this.ch(0x0e), this.rd(this.ch(0x0e)) - 1);
    if (!this.rd(this.ch(0x0e))) {
      // 41BD: the envelope list (two bytes an entry: ticks, value)
      let at: number;
      for (;;) {
        const de = this.word((0x6870 + 2 * this.rd(this.ch(0x0c))) & 0xffff);
        const p = this.rd(this.ch(0x0d));
        this.wr(this.ch(0x0d), p + 2);
        at = (de + p) & 0xffff;
        const t = this.rd(at);
        this.wr(this.ch(0x0e), t);
        if (t !== 0) break;
        this.wr(this.ch(0x0d), this.rd(at + 1));
      }
      const v = this.rd(at + 1);
      const e = v >> 4;
      let d = this.rd(this.ch(0x0b)), a = 0;
      for (let k = 0; k < 4; k++, d = (d << 1) & 0xff) if (e & (1 << k)) a = (a + d) & 0xff;
      a = (a + 0x10) & 0xff;
      const hi = c === 2 ? this.rd(0x43ea + (a >> 4)) : a & 0xf0;
      const nrx2 = (hi | (v & 0x0f)) & 0xff;
      this.wr(this.ch(0x19), nrx2);
      if (this.free()) {
        const r = this.rd(0x43fd + c);
        this.wr(ff(r), nrx2);
        if (c !== 2) this.wr(ff(r + 2), (this.rd(this.ch(0x1b)) | 0x80) & 0x87);
      }
    }
    this.pitch();
  }

  /** 07:425C — pitch (07:68D3: ticks, signed offset from the note's frequency); NRx3/NRx4
   *  written when they change. */
  private pitch(): void {
    const c = this.hr(0xffe9);
    if (this.hr(0xffe6) !== 0x0f) {
      this.wr(this.ch(0x10), 0);
      this.wr(this.ch(0x11), 1);
    }
    this.wr(this.ch(0x11), this.rd(this.ch(0x11)) - 1);
    if (!this.rd(this.ch(0x11))) {
      const at = this.walk(0x68d3, 0x0f, 0x10, 0x11, 2);
      this.wr(this.ch(0x11), this.rd(at));
      const bc = this.rd(this.ch(9)) | (this.rd(this.ch(10)) << 8);
      const o = this.rd(at + 1);
      const f = (bc + (o & 0x80 ? o | 0xff00 : o)) & 0xffff;
      if (this.free()) {
        const r = this.rd(0x43fa + c);
        if ((f & 0xff) !== this.rd(this.ch(0x1a))) {
          this.wr(this.ch(0x1a), f);
          this.wr(ff(r), f);
        }
        const hi = (f >> 8) & 7;
        if (hi !== this.rd(this.ch(0x1b))) {
          this.wr(this.ch(0x1b), hi);
          this.wr(ff(r + 1), hi);
        }
      }
    }
    this.duty();
  }

  /** 07:42DF — duty (07:69AE: duty << 6 | ticks) into NRx1. */
  private duty(): void {
    const c = this.hr(0xffe9);
    if (this.hr(0xffe6) !== 0x0f) {
      this.wr(this.ch(0x13), 0);
      this.wr(this.ch(0x14), 1);
    }
    this.wr(this.ch(0x14), this.rd(this.ch(0x14)) - 1);
    if (!this.rd(this.ch(0x14))) {
      const at = this.walk(0x69ae, 0x12, 0x13, 0x14, 1);
      const b = this.rd(at);
      this.wr(this.ch(0x14), b & 0x3f);
      if (this.free()) this.wr(ff(this.rd(0x4400 + c)), b & 0xc0);
    }
    this.panning();
  }

  /** 07:4338 — panning (07:692F: left/right << 6 | ticks) into NR51 (07:4386); the note is
   *  consumed ([04] = FFE6 = 0F). */
  private panning(): void {
    this.wr(this.ch(0x17), this.rd(this.ch(0x17)) - 1);
    if (!this.rd(this.ch(0x17))) {
      const at = this.walk(0x692f, 0x15, 0x16, 0x17, 1);
      const a = this.rd(at);
      this.wr(this.ch(0x17), a & 0x3f);
      this.wr(this.ch(0x1c), a);
      this.pan(a);
    }
    this.wr(this.ch(4), 0x0f);
    this.hw(0xffe6, 0x0f);
  }

  /** 07:4386 — the channel's NR51 bits from panning bits 7 (left) and 6 (right); pulse 1 not
   *  while an effect owns it. */
  private pan(e: number): void {
    const c = this.hr(0xffe9);
    if (c === 0 && this.rd(0xce00) & 1) return;
    const [l, r, mask] = c === 0 ? [0x10, 0x01, 0xee] : c === 1 ? [0x20, 0x02, 0xdd] : [0x40, 0x04, 0xbb];
    let a = 0;
    if (e & 0x80) a |= l;
    if (e & 0x40) a |= r;
    this.wr(ff(0x25), (this.m.io[0x25]! & mask) | a);
  }

  /** 07:44BC — each channel's sequence (07:44DC). */
  private sequences(): void {
    for (let c = 0; c < 3; c++) this.sequence(c);
  }

  /** 07:45C1 — the next sequence byte. */
  private next(): number {
    const p = this.ch(2);
    const de = this.rd(p) | (this.rd(p + 1) << 8);
    const a = this.rd(de);
    const n = (de + 1) & 0xffff;
    this.wr(p, n & 0xff);
    this.wr(p + 1, n >> 8);
    return a;
  }

  /** 07:44DC — when the note's ticks run out: commands until the next note (00-DF, into [04]).
   *  E0 tempo, E1-EF volume, F0-F4 octave, F5 NRx1, F7 a table (envelope / pitch / duty /
   *  panning), F8 a wave pattern (07:69BD), F9-FB loop count, FC loop back while counting, FD
   *  jump when the count is out, FE jump, FF end. */
  private sequence(c: number): void {
    const base = 0xce00 + 0x20 * c;
    this.hw(0xffe9, c);
    this.hw(0xffe7, base & 0xff);
    this.hw(0xffe8, base >> 8);
    if (this.rd(base) & 0x80) return;
    this.wr(base + 1, this.rd(base + 1) - 1);
    if (this.rd(base + 1)) return;
    for (;;) {
      const a = this.next();
      if (a < 0xe0) { this.wr(this.ch(4), a); return; }
      if (a === 0xff) {
        this.wr(base, this.rd(base) | 0x80);
        this.wr(ff(this.rd(0x45a0 + c)), 0);
        return;
      }
      if (a < 0xf0) {
        if (a & 0x0f) this.wr(this.ch(0x0b), a & 0x0f);
        else this.hw(0xffea, this.next());
        continue;
      }
      switch (a) {
        case 0xf0: case 0xf1: case 0xf2: case 0xf3: case 0xf4:
          this.wr(this.ch(5), a & 0x0f);
          break;
        case 0xf5:
          this.wr(this.ch(0x18), this.next());
          break;
        case 0xf6:
          throw new Error("sound driver: command F6 (jumps to 0000)");
        case 0xf7: {
          const b = this.next();
          const n = this.rd(0x4629 + ((b >> 6) & 3));
          this.wr(this.ch(n), b & 0x3f);
          this.wr(this.ch(n + 1), 0);
          this.wr(this.ch(n + 2), 1);
          break;
        }
        case 0xf8: {
          this.wr(ff(0x1a), 0);
          const x = this.next();
          const src = (0x69bd + x * 16) & 0xffff;
          for (let i = 0; i < 16; i++) this.wr(ff(0x30 + i), this.rd(src + i));
          this.wr(ff(0x1a), 0x80);
          this.wr(ff(0x1e), (this.rd(0xce5b) | 0x80) & 0x87);
          break;
        }
        case 0xf9: case 0xfa: case 0xfb:
          this.wr(this.ch(6), (a & 0x0f) - 8);
          break;
        case 0xfc:
          if (this.rd(this.ch(6)) === 0) { this.next(); this.next(); break; }
          this.wr(this.ch(6), this.rd(this.ch(6)) - 1);
          this.jump();
          break;
        case 0xfd:
          if (this.rd(this.ch(6)) === 0) this.jump();
          else { this.next(); this.next(); }
          break;
        case 0xfe:
          this.jump();
          break;
      }
    }
  }

  /** 07:458E — FE: the sequence pointer from the next two bytes. */
  private jump(): void {
    const lo = this.next(), hi = this.next();
    this.wr(this.ch(3), hi);
    this.wr(this.ch(2), lo);
  }

  /** 07:6AA8 — a sound effect request (FFE4): pointers for pulse 1 (07:6BC7) and noise
   *  (07:6C0F), pulse 1 taken from the music; then each effect channel's step. */
  private effects(): void {
    const r = this.hr(0xffe4);
    if (r) {
      const e = ((r - 1) * 2) & 0xff;
      this.hw(0xffeb, this.rd(0x6bc7 + e));
      this.hw(0xffec, this.rd(0x6bc8 + e));
      this.hw(0xffed, this.rd(0x6c0f + e));
      this.hw(0xffee, this.rd(0x6c10 + e));
      this.wr(0xce00, this.rd(0xce00) | 1);
      this.wr(0xcec7, 1);
      this.wr(0xcec3, 1);
      this.wr(0xcec4, 1);
      this.hw(0xffe4, 0);
    }
    if (this.rd(0xce00) & 1) this.pulseEffect();
    if (this.rd(0xcec7) & 1) this.noiseEffect();
  }

  /** E-loop markers shared by both effect channels: Ex sets the count, F0 lo hi loops back
   *  while it runs. Returns the address of the effect's next step. */
  private effectPos(ptr: number, count: number): number {
    for (;;) {
      let hl = this.hr(ptr) | (this.hr(ptr + 1) << 8);
      for (;;) {
        const a = this.rd(hl) & 0xf0;
        if (a === 0xe0) { this.wr(count, this.rd(hl) & 0x0f); hl++; continue; }
        if (a !== 0xf0) return hl;
        const n = (this.rd(count) - 1) & 0xff;
        this.wr(count, n);
        hl++;
        if (n === 0) { hl += 2; continue; }
        this.hw(ptr, this.rd(hl));
        this.hw(ptr + 1, this.rd(hl + 1));
        break;
      }
    }
  }

  /** 07:6AF0 — pulse 1 effect: steps of (ticks, NR10-NR14); 00 ends it and gives pulse 1 back
   *  to the music (NR11-NR14 from CE18-CE1B; the pointer is left at CE1C, as the original). */
  private pulseEffect(): void {
    this.wr(0xcec3, this.rd(0xcec3) - 1);
    if (this.rd(0xcec3)) return;
    this.wr(ff(0x25), this.m.io[0x25]! | 0x11);
    let hl = this.effectPos(0xffeb, 0xcec5);
    const a = this.rd(hl++);
    if (a === 0) {
      this.wr(0xce00, this.rd(0xce00) & ~1);
      this.wr(ff(0x10), 0);
      this.wr(ff(0x25), this.m.io[0x25]! & 0xee);
      hl = 0xce18;
      for (let r = 0x11; r <= 0x14; r++) this.wr(ff(r), this.rd(hl++));
    } else {
      this.wr(0xcec3, a);
      for (let r = 0x10; r <= 0x14; r++) this.wr(ff(r), this.rd(hl++));
    }
    this.hw(0xffeb, hl & 0xff);
    this.hw(0xffec, hl >> 8);
  }

  /** 07:6B51 — noise effect: steps of (ticks, NR42, NR43), NR41 = 0, NR44 = 80; 00 ends it. */
  private noiseEffect(): void {
    this.wr(0xcec4, this.rd(0xcec4) - 1);
    if (this.rd(0xcec4)) return;
    this.wr(ff(0x25), this.m.io[0x25]! | 0x88);
    let hl = this.effectPos(0xffed, 0xcec6);
    const a = this.rd(hl++);
    if (a === 0) {
      this.wr(0xcec7, 0);
      this.wr(ff(0x25), this.m.io[0x25]! & 0x77);
      return;
    }
    this.wr(0xcec4, a);
    this.wr(ff(0x20), 0);
    this.wr(ff(0x21), this.rd(hl++));
    this.wr(ff(0x22), this.rd(hl++));
    this.wr(ff(0x23), 0x80);
    this.hw(0xffed, hl & 0xff);
    this.hw(0xffee, hl >> 8);
  }
}
