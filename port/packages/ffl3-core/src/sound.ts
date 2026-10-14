/** Legend III sound driver (bank 0F, 0F:4000-482E), ported routine by routine over the original
 *  RAM (CB00-CB67, FFBA-FFC9) and the APU registers (FF10-FF3F), so its state compares byte for
 *  byte with the emulator. Every method reads its tables (song pointers 0F:482F, durations
 *  0F:41BE, frequencies 0F:4114, octave steps 0F:4420, command jump tables 0F:4428/4448/4468/4488,
 *  panning 0F:4603-4612, noise 0F:4619, sound effects 0F:66F2 / 0F:6774, the sequences, envelope
 *  and vibrato lists, wave patterns) through `g.m.rd` from the selected ROM bank: the CALLER
 *  selects bank 0F, as 00:1F3A (irq.ts `soundTick`), 00:3624, 00:3A60 and 0F:7EBF do.
 *
 *  Entry points: 0F:4000 `jr $4006` (the tick, `tick`), 0F:4003 `jr $4031` (the reset, `reset`;
 *  no caller found in the listings: the game resets through song request 0, FFBA = 0).
 *
 *  Music: four channels of 0x18 bytes: A at CB02 (pulse 2, FF16-FF19), B at CB1A (pulse 1,
 *  FF10-FF14, lent to the pulse sound effects), C at CB32 (wave, FF1A-FF1E), D at CB4A (noise,
 *  FF20-FF23, lent to the noise sound effects). CB00 tempo accumulator, CB01 tempo (each carry
 *  out of CB00 + CB01 runs the sequencer twice).
 *
 *  Channel record (+n from its base):
 *    00 loop counter 1 (F3 set, F2 loop, FB jump if equal)   01 loop counter 2 (FA set, F9 loop)
 *    02 (B: CB1C pulse effect ticks; D: CB4C noise effect ticks; A, C unused)
 *    03 00 playing / FF ended   04 ticks left in the note   05 pitch (0-B note, C hold, D-F rest)
 *    06 octave offset (24 per octave, E0-EF)   07/08 sequence pointer (stored at each note)
 *    09 (C: NR32 volume, F0)   0A/0B note frequency (A/B: NRx4 byte with the trigger bit; C: NR34
 *    & 07; D: 0A = NR43)   0C vibrato ticks   0D/0E vibrato list (F4)   0F/10 vibrato position
 *    11 envelope ticks (FF: held)   12/13 envelope list (F0)   14/15 envelope position
 *    16 duty (A: NR21, B: NR11; F5)   17 NR51 bits (B and D only; F6)
 *  Lists: vibrato (ticks, signed offset from the note's frequency), envelope (ticks, NRx2); an
 *  entry with ticks 00 continues at the address after it.
 *  Sound effects: CB62/63 pulse 1 effect pointer (steps: ticks, NR10-NR14), CB64/65 noise effect
 *  pointer (steps: ticks, NR42, NR43), Fx = loop count (FFC4 / FFC5), EF lo hi = loop back while
 *  counting, 00 = end. CB66 / CB67: the pulse / noise effect ran (the music channel's envelope and
 *  vibrato wait for its next note).
 *  HRAM: FFBA song requested (0 resets), FFBB song playing, FFBC sound effect requested (cleared
 *  when taken), FFBD the channel whose envelope and vibrato run this tick (0 A, 1 B, 2 C and D),
 *  FFBE-FFC1 channels A-D ticks left after the last count, FFC2/C3 wave pattern pointer, FFC4 /
 *  FFC5 pulse / noise effect loop counts. */
import type { Game } from "./game.js";
import { NotPorted } from "./irq.js";

const ff = (r: number) => 0xff00 | r;

export class SoundDriver {
  /** The sequence pointer while a channel reads its commands (register de). */
  private de = 0;

  constructor(readonly g: Game) {}

  private get m() { return this.g.m; }
  private hr(a: number): number { return this.m.hram[a - 0xff80]!; }
  private hw(a: number, v: number): void { this.m.hram[a - 0xff80] = v & 0xff; }
  private rd(a: number): number { return this.m.rd(a & 0xffff); }
  private wr(a: number, v: number): void { this.m.wr(a & 0xffff, v & 0xff); }
  private word(a: number): number { return this.rd(a) | (this.rd(a + 1) << 8); }
  /** `ld a,[de]; inc de`. */
  private fetch(): number {
    const a = this.rd(this.de);
    this.de = (this.de + 1) & 0xffff;
    return a;
  }

  /** 0F:4006 — the tick (00:1F3A from the STAT handler, 00:3624, 00:3A60, 0F:7EBF): unless a sound
   *  effect is playing (CB1C | CB4C), a new song request (FFBA differs from FFBB, 0F:402D); a sound
   *  effect request (FFBC, 0F:4759); the music (0F:41CE); the sound effects (0F:478E). */
  tick(): void {
    if ((this.rd(0xcb4c) | this.rd(0xcb1c)) === 0) {
      const a = this.hr(0xffba);
      if (a !== this.hr(0xffbb)) this.request(a);
    }
    const r = this.hr(0xffbc);
    if (r) this.effectRequest(r);
    this.music();
    this.effects();
  }

  /** 0F:402D — FFBB = the request a; 0 resets (0F:4031), else song a starts (0F:4065). */
  private request(a: number): void {
    this.hw(0xffbb, a);
    if (a === 0) this.reset();
    else this.start(a);
  }

  /** 0F:4031 (also the 0F:4003 stub) — reset: NR52 = FF, NR12 / NR22 / NR32 = 08, the channels
   *  silenced (0F:40B9), NR50 = 77, NR51 = FF, the four music channels ended (FF at CB05 CB1D CB35
   *  CB4D), no pulse effect (CB1C = 0), tempo 0 (CB01), FFBA-FFC9 cleared. */
  reset(): void {
    this.wr(ff(0x26), 0xff);
    this.wr(ff(0x12), 0x08);
    this.wr(ff(0x17), 0x08);
    this.wr(ff(0x1c), 0x08);
    this.silence();
    this.wr(ff(0x24), 0x77);
    this.wr(ff(0x25), 0xff);
    this.wr(0xcb05, 0xff);
    this.wr(0xcb1d, 0xff);
    this.wr(0xcb35, 0xff);
    this.wr(0xcb4d, 0xff);
    this.wr(0xcb1c, 0);
    this.wr(0xcb01, 0);
    for (let i = 0; i < 0x10; i++) this.hw(0xffba + i, 0);
  }

  /** 0F:4065 — song a (1-14; others ignored): the four sequence pointers from 0F:482F + 8(a - 1)
   *  (CB09, CB21, CB39, CB51), CB00 = FF, tempo 3C, each channel playing with one tick left
   *  (0F:40B1). */
  private start(a: number): void {
    const x = (a - 1) & 0xff;
    if (x >= 0x14) return;
    const hl = 0x482f + ((x * 8) & 0xff);
    this.wr(0xcb09, this.rd(hl));
    this.wr(0xcb0a, this.rd(hl + 1));
    this.wr(0xcb21, this.rd(hl + 2));
    this.wr(0xcb22, this.rd(hl + 3));
    this.wr(0xcb39, this.rd(hl + 4));
    this.wr(0xcb3a, this.rd(hl + 5));
    this.wr(0xcb51, this.rd(hl + 6));
    this.wr(0xcb52, this.rd(hl + 7));
    this.wr(0xcb00, 0xff);
    this.wr(0xcb01, 0x3c);
    this.clear(0xcb02);
    this.clear(0xcb1a);
    this.clear(0xcb32);
    this.clear(0xcb4a);
  }

  /** 0F:40B1 — a channel record's +00..+03 = 0, +04 (ticks left) = 1. */
  private clear(hl: number): void {
    for (let i = 0; i < 4; i++) this.wr(hl + i, 0);
    this.wr(hl + 4, 1);
  }

  /** 0F:40B9 — CB66 = CB67 = 0, NR10 = 0, the frequencies FF / 07 (no trigger) on pulse 1, pulse 2
   *  and wave, NR42 = 0, NR44 = 80. */
  private silence(): void {
    this.wr(0xcb66, 0);
    this.wr(0xcb67, 0);
    this.wr(ff(0x10), 0);
    this.wr(ff(0x13), 0xff);
    this.wr(ff(0x18), 0xff);
    this.wr(ff(0x1b), 0xff);
    this.wr(ff(0x1d), 0xff);
    this.wr(ff(0x14), 0x07);
    this.wr(ff(0x19), 0x07);
    this.wr(ff(0x1e), 0x07);
    this.wr(ff(0x21), 0x00);
    this.wr(ff(0x23), 0x80);
  }

  /** 0F:40DD — the pulse effect ended: pulse 1 back to the music (NR10 = 0, NR11 = CB30, NR12 = 0,
   *  NR13 = FF, NR14 = 87, NR51 pulse 1 bits from CB31). */
  private pulseBack(): void {
    this.wr(ff(0x10), 0);
    this.wr(ff(0x11), this.rd(0xcb30));
    this.wr(ff(0x12), 0x00);
    this.wr(ff(0x13), 0xff);
    this.wr(ff(0x14), 0x87);
    const e = this.rd(0xcb31);
    this.wr(ff(0x25), (this.rd(ff(0x25)) & 0xee) | e);
  }

  /** 0F:40FD — the noise effect ended: NR42 = 08, NR43 = 0, NR44 = 80, NR51 noise bits from
   *  CB61. */
  private noiseBack(): void {
    this.wr(ff(0x21), 0x08);
    this.wr(ff(0x22), 0);
    this.wr(ff(0x23), 0x80);
    const e = this.rd(0xcb61);
    this.wr(ff(0x25), (this.rd(ff(0x25)) & 0x77) | e);
  }

  /** 0F:41CE — CB00 += CB01; a carry runs the sequencer twice (0F:41F9). Then FFBD steps 0, 1, 2
   *  and that channel's envelope and vibrato run: 0 A (0F:4625), 1 B (0F:467D), 2 C and D
   *  (0F:46DB). */
  private music(): void {
    const s = this.rd(0xcb01) + this.rd(0xcb00);
    this.wr(0xcb00, s);
    if (s > 0xff) {
      this.sequencer();
      this.sequencer();
    }
    let a = (this.hr(0xffbd) + 1) & 0xff;
    if (a === 3) a = 0;
    this.hw(0xffbd, a);
    if (a === 0) this.updateA();
    if (this.hr(0xffbd) === 1) this.updateB();
    if (this.hr(0xffbd) === 2) this.updateCD();
  }

  /** 0F:41F9 — a sequencer step of the four channels (A 41F9, B 4260, C 42D3, D 4334). */
  private sequencer(): void {
    this.seqA();
    this.seqB();
    this.seqC();
    this.seqD();
  }

  /** 0F:4408 — note byte a: duration 0F:41BE[a & 0F]; pitch a >> 4 (register e = swap a). */
  private noteLength(a: number): { dur: number; pitch: number } {
    return { dur: this.rd(0x41be + (a & 0x0f)), pitch: (a >> 4) & 0x0f };
  }

  /** 0F:4416 — the frequency entry: 0F:4114 + (2 x pitch + [octave]) (8-bit). */
  private freqAt(pitch: number, octave: number): number {
    return 0x4114 + ((pitch * 2 + this.rd(octave)) & 0xff);
  }

  /** 0F:439B — a list restarts: [hl] = 1 (ticks), position [hl+3..4] = list [hl+1..2]. */
  private restart(hl: number): void {
    this.wr(hl, 1);
    const a = this.rd(hl + 1);
    const e = this.rd(hl + 2);
    this.wr(hl + 3, a);
    this.wr(hl + 4, e);
  }

  /** 0F:41F9 — channel A (pulse 2, CB02): when its ticks run out (CB06, copied to FFBE), commands
   *  (0F:43DA) up to the next note; FF ends it (CB05 = FF, NR23 = FF, NR24 = 07). A note: CB06 =
   *  duration, CB07 = pitch; C holds, D-F silence (NR23 = FF, NR24 = 07); else NR22 = the
   *  envelope's first value, NR23 / NR24 = frequency (CB0C/0D), vibrato and envelope restart. */
  private seqA(): void {
    if (this.rd(0xcb05) === 0xff) return;
    const t = (this.rd(0xcb06) - 1) & 0xff;
    this.wr(0xcb06, t);
    this.hw(0xffbe, t);
    if (t) return;
    this.de = this.word(0xcb09);
    let a: number;
    for (;;) {
      a = this.fetch();
      if (a < 0xe0) break;
      if (a === 0xff) {
        this.wr(0xcb05, a);
        this.wr(ff(0x18), 0xff);
        this.wr(ff(0x19), 0x07);
        return;
      }
      this.command(a, 0x4428, 0xcb08);
    }
    this.wr(0xcb09, this.de & 0xff);
    this.wr(0xcb0a, this.de >> 8);
    const n = this.noteLength(a);
    this.wr(0xcb06, n.dur);
    this.wr(0xcb07, n.pitch);
    if (n.pitch === 0x0c) return;
    if (n.pitch > 0x0c) {
      this.wr(ff(0x18), 0xff);
      this.wr(ff(0x19), 0x07);
      return;
    }
    const f = this.freqAt(n.pitch, 0xcb08);
    this.wr(ff(0x17), this.rd(this.word(0xcb14) + 1));
    const lo = this.rd(f), hi = this.rd(f + 1);
    this.wr(ff(0x18), lo);
    this.wr(0xcb0c, lo);
    this.wr(ff(0x19), hi);
    this.wr(0xcb0d, hi);
    this.restart(0xcb0e);
    this.restart(0xcb13);
  }

  /** 0F:4260 — channel B (pulse 1, CB1A), as A (ticks CB1E / FFBF; FF: CB1D = FF, NR13 = FF,
   *  NR14 = 07); while a pulse effect plays (CB1C) a note only sets CB1E / CB1F; a note clears
   *  CB66. */
  private seqB(): void {
    if (this.rd(0xcb1d) === 0xff) return;
    const t = (this.rd(0xcb1e) - 1) & 0xff;
    this.wr(0xcb1e, t);
    this.hw(0xffbf, t);
    if (t) return;
    this.de = this.word(0xcb21);
    let a: number;
    for (;;) {
      a = this.fetch();
      if (a < 0xe0) break;
      if (a === 0xff) {
        this.wr(0xcb1d, a);
        this.wr(ff(0x13), 0xff);
        this.wr(ff(0x14), 0x07);
        return;
      }
      this.command(a, 0x4448, 0xcb20);
    }
    this.wr(0xcb21, this.de & 0xff);
    this.wr(0xcb22, this.de >> 8);
    const n = this.noteLength(a);
    this.wr(0xcb1e, n.dur);
    this.wr(0xcb1f, n.pitch);
    if (this.rd(0xcb1c)) return;
    if (n.pitch === 0x0c) return;
    if (n.pitch > 0x0c) {
      this.wr(ff(0x13), 0xff);
      this.wr(ff(0x14), 0x07);
      return;
    }
    const f = this.freqAt(n.pitch, 0xcb20);
    this.wr(ff(0x12), this.rd(this.word(0xcb2c) + 1));
    const lo = this.rd(f), hi = this.rd(f + 1);
    this.wr(ff(0x13), lo);
    this.wr(0xcb24, lo);
    this.wr(ff(0x14), hi);
    this.wr(0xcb25, hi);
    this.restart(0xcb26);
    this.restart(0xcb2b);
    this.wr(0xcb66, 0);
  }

  /** 0F:42D3 — channel C (wave, CB32), ticks CB36 / FFC0; FF: CB35 = FF, NR33 = FF, NR34 = 07. A
   *  note: C holds, D-F NR32 = 0; else NR32 = CB3B, NR33 = frequency low, NR34 = high & 07 (no
   *  trigger; CB3C/3D), vibrato restarts. */
  private seqC(): void {
    if (this.rd(0xcb35) === 0xff) return;
    const t = (this.rd(0xcb36) - 1) & 0xff;
    this.wr(0xcb36, t);
    this.hw(0xffc0, t);
    if (t) return;
    this.de = this.word(0xcb39);
    let a: number;
    for (;;) {
      a = this.fetch();
      if (a < 0xe0) break;
      if (a === 0xff) {
        this.wr(0xcb35, a);
        this.wr(ff(0x1d), a);
        this.wr(ff(0x1e), 0x07);
        return;
      }
      this.command(a, 0x4468, 0xcb38);
    }
    this.wr(0xcb39, this.de & 0xff);
    this.wr(0xcb3a, this.de >> 8);
    const n = this.noteLength(a);
    this.wr(0xcb36, n.dur);
    this.wr(0xcb37, n.pitch);
    if (n.pitch > 0x0c) {
      this.wr(ff(0x1c), 0);
      return;
    }
    if (n.pitch === 0x0c) return;
    const f = this.freqAt(n.pitch, 0xcb38);
    const c = this.rd(f), b = this.rd(f + 1);
    this.wr(ff(0x1c), this.rd(0xcb3b));
    this.wr(ff(0x1d), c);
    this.wr(0xcb3c, c);
    this.wr(ff(0x1e), b & 0x07);
    this.wr(0xcb3d, b & 0x07);
    this.restart(0xcb3e);
  }

  /** 0F:4352 — noise silenced: NR42 = NR43 = 0, NR44 = 80. */
  private noiseOff(): void {
    this.wr(ff(0x21), 0);
    this.wr(ff(0x22), 0);
    this.wr(ff(0x23), 0x80);
  }

  /** 0F:4334 — channel D (noise, CB4A), ticks CB4E / FFC1; FF: CB4D = FF, noise off (0F:4352).
   *  Every command E0-FE goes through the jump table 0F:4488 (no octave). While a noise effect
   *  plays (CB4C) a note only sets CB4E / CB4F; C holds, D-F noise off; else NR42 = the envelope's
   *  first value, NR43 = 0F:4619[pitch] (CB54), NR44 = 80, CB67 = 0, the envelope restarts. */
  private seqD(): void {
    if (this.rd(0xcb4d) === 0xff) return;
    const t = (this.rd(0xcb4e) - 1) & 0xff;
    this.wr(0xcb4e, t);
    this.hw(0xffc1, t);
    if (t) return;
    this.de = this.word(0xcb51);
    let a: number;
    for (;;) {
      a = this.fetch();
      if (a < 0xe0) break;
      if (a === 0xff) {
        this.wr(0xcb4d, a);
        this.noiseOff();
        return;
      }
      this.command(a, 0x4488, -1);
    }
    this.wr(0xcb51, this.de & 0xff);
    this.wr(0xcb52, this.de >> 8);
    const n = this.noteLength(a);
    this.wr(0xcb4e, n.dur);
    this.wr(0xcb4f, n.pitch);
    if (this.rd(0xcb4c)) return;
    if (n.pitch === 0x0c) return;
    if (n.pitch > 0x0c) { this.noiseOff(); return; }
    const c = this.rd(0x4619 + n.pitch);
    this.wr(ff(0x21), this.rd(this.word(0xcb5c) + 1));
    this.wr(ff(0x22), c);
    this.wr(0xcb54, c);
    this.wr(ff(0x23), 0x80);
    this.wr(0xcb67, 0);
    this.restart(0xcb5b);
  }

  /** 0F:43DA / 43C8 / 43B6 (A / B / C) and 0F:43A4 (D) — command a: E0-EF the octave at `octave`
   *  (0F:43EA; not on D, octave < 0); else the handler at word[table + 2 (a & 0F)] (0F:43AB). */
  private command(a: number, table: number, octave: number): void {
    if (octave >= 0 && a < 0xf0) { this.octave(a, octave); return; }
    this.handler(this.word(table + (a & 0x0f) * 2));
  }

  /** 0F:43EA — E0-E7: [bc] = 24 (a & 7); E8-EF: [bc] += 0F:4420[a & 7] (+24 +48 +72 +96 -24 -48
   *  -72 -96, 8-bit). */
  private octave(a: number, bc: number): void {
    if (!(a & 0x08)) this.wr(bc, (a & 7) * 24);
    else this.wr(bc, this.rd(bc) + this.rd(0x4420 + (a & 7)));
  }

  /** A command handler by address (the jump tables' words; 0F:44A8-4618 are code the listing shows
   *  as data). */
  private handler(at: number): void {
    switch (at) {
      case 0x44a8: this.waveVolume(); break;
      case 0x44b0: this.setWord(0xcb14); break;
      case 0x44b5: this.setWord(0xcb2c); break;
      case 0x44ba: this.setWord(0xcb5c); break;
      case 0x44bf: this.setWord(0xcb0f); break;
      case 0x44c4: this.setWord(0xcb27); break;
      case 0x44c9: this.setWord(0xcb3f); break;
      case 0x44d3: this.setByte(0xcb02); break;
      case 0x44d9: this.setByte(0xcb1a); break;
      case 0x44df: this.setByte(0xcb32); break;
      case 0x44e5: this.setByte(0xcb4a); break;
      case 0x44eb: this.setByte(0xcb03); break;
      case 0x44f1: this.setByte(0xcb1b); break;
      case 0x44f7: this.setByte(0xcb33); break;
      case 0x44fd: this.setByte(0xcb4b); break;
      case 0x4503: this.loop(0xcb02); break;
      case 0x4508: this.loop(0xcb1a); break;
      case 0x450d: this.loop(0xcb32); break;
      case 0x4512: this.loop(0xcb4a); break;
      case 0x4517: this.loop(0xcb03); break;
      case 0x451c: this.loop(0xcb1b); break;
      case 0x4521: this.loop(0xcb33); break;
      case 0x4526: this.loop(0xcb4b); break;
      case 0x452f: this.jumpIf(0xcb02); break;
      case 0x4534: this.jumpIf(0xcb1a); break;
      case 0x4539: this.jumpIf(0xcb32); break;
      case 0x453e: this.jumpIf(0xcb4a); break;
      case 0x4548: this.jump(); break;
      case 0x454e: this.dutyA(); break;
      case 0x4556: this.dutyB(); break;
      case 0x4565: this.tempo(); break;
      case 0x456b: this.loadWave(); break;
      case 0x458f: this.instrumentA(); break;
      case 0x459b: this.panA(); break;
      case 0x45ac: this.instrumentB(); break;
      case 0x45b5: this.panB(); break;
      case 0x45cf: this.instrumentC(); break;
      case 0x45d8: this.panC(); break;
      case 0x45e9: this.panD(); break;
      case 0x4613: this.skip(); break;
      case 0x4616: this.hang(); break;
      default: throw new NotPorted(`0F:${at.toString(16).toUpperCase()} (sound command handler)`);
    }
  }

  /** 0F:44A8 — C F0: CB3B = NR32 = the next byte (wave volume). */
  private waveVolume(): void {
    const a = this.fetch();
    this.wr(0xcb3b, a);
    this.wr(ff(0x1c), a);
  }

  /** 0F:44CC (entries 44B0 / 44B5 / 44BA envelope list of A / B / D, F0; 44BF / 44C4 / 44C9
   *  vibrato list of A / B / C, F4) — [hl], [hl+1] = the next two bytes. */
  private setWord(hl: number): void {
    this.wr(hl, this.fetch());
    this.wr(hl + 1, this.fetch());
  }

  /** 0F:44D3-4502 (eight copies) — a loop counter = the next byte: F3 counter 1 (CB02 CB1A CB32
   *  CB4A), FA counter 2 (CB03 CB1B CB33 CB4B). */
  private setByte(a: number): void {
    this.wr(a, this.fetch());
  }

  /** 0F:4529 (entries 4503-4526; F2 counter 1, F9 counter 2) — [hl] - 1: not 0, jump (0F:4548);
   *  0, the address skipped (0F:452C). */
  private loop(hl: number): void {
    const n = (this.rd(hl) - 1) & 0xff;
    this.wr(hl, n);
    if (n) this.jump();
    else this.de = (this.de + 2) & 0xffff;
  }

  /** 0F:4543 (entries 452F / 4534 / 4539 / 453E; FB) — the next byte equals loop counter 1:
   *  jump (0F:4548); else the address skipped (0F:452C). */
  private jumpIf(hl: number): void {
    const a = this.fetch();
    if (a !== this.rd(hl)) this.de = (this.de + 2) & 0xffff;
    else this.jump();
  }

  /** 0F:4548 — F1: the sequence goes on at the next two bytes' address. */
  private jump(): void {
    this.de = this.word(this.de);
  }

  /** 0F:454E — A F5: NR21 = CB18 = the next byte. */
  private dutyA(): void {
    const a = this.fetch();
    this.wr(ff(0x16), a);
    this.wr(0xcb18, a);
  }

  /** 0F:4556 — B F5: CB30 = the next byte, NR11 too unless a pulse effect plays (CB1C). */
  private dutyB(): void {
    const a = this.fetch();
    this.wr(0xcb30, a);
    if (this.rd(0xcb1c)) return;
    this.wr(ff(0x11), a);
  }

  /** 0F:4565 — A F7: tempo CB01 = the next byte. */
  private tempo(): void {
    this.wr(0xcb01, this.fetch());
  }

  /** 0F:456B — C F8: wave pattern at the next two bytes' address (FFC2/C3): NR30 = 0, 16 bytes to
   *  FF30-FF3F, NR30 = 80, NR32 = 0, NR34 = 87. */
  private loadWave(): void {
    const c = this.fetch();
    this.hw(0xffc2, c);
    const a = this.fetch();
    this.hw(0xffc3, a);
    const hl = (a << 8) | c;
    this.wr(ff(0x1a), 0);
    for (let i = 0; i < 16; i++) this.wr(ff(0x30 + i), this.rd(hl + i));
    this.wr(ff(0x1a), 0x80);
    this.wr(ff(0x1c), 0);
    this.wr(ff(0x1e), 0x87);
  }

  /** 0F:458F — A FE: tempo, vibrato list, envelope list, duty, panning (0F:4565, 44BF, 44B0,
   *  454E, 459B). */
  private instrumentA(): void {
    this.tempo();
    this.setWord(0xcb0f);
    this.setWord(0xcb14);
    this.dutyA();
    this.panA();
  }

  /** 0F:459B — A F6: NR51 pulse 2 bits = 0F:4603[next byte]. */
  private panA(): void {
    const c = this.fetch();
    this.wr(ff(0x25), (this.rd(ff(0x25)) & 0xdd) | this.rd(0x4603 + c));
  }

  /** 0F:45AC — B FE: vibrato list, envelope list, duty, panning (0F:44C4, 44B5, 4556, 45B5). */
  private instrumentB(): void {
    this.setWord(0xcb27);
    this.setWord(0xcb2c);
    this.dutyB();
    this.panB();
  }

  /** 0F:45B5 — B F6: CB31 = 0F:4607[next byte], into NR51's pulse 1 bits unless a pulse effect
   *  plays (CB1C). */
  private panB(): void {
    const c = this.fetch();
    const v = this.rd(0x4607 + c);
    this.wr(0xcb31, v);
    if (this.rd(0xcb1c)) return;
    this.wr(ff(0x25), (this.rd(ff(0x25)) & 0xee) | v);
  }

  /** 0F:45CF — C FE: vibrato list, volume, wave pattern, panning (0F:44C9, 44A8, 456B, 45D8). */
  private instrumentC(): void {
    this.setWord(0xcb3f);
    this.waveVolume();
    this.loadWave();
    this.panC();
  }

  /** 0F:45D8 — C F6: NR51 wave bits = 0F:460B[next byte]. */
  private panC(): void {
    const c = this.fetch();
    this.wr(ff(0x25), (this.rd(ff(0x25)) & 0xbb) | this.rd(0x460b + c));
  }

  /** 0F:45E9 — D F6 / E6: CB61 = 0F:460F[next byte], into NR51's noise bits unless a noise effect
   *  plays (CB4C). */
  private panD(): void {
    const c = this.fetch();
    const v = this.rd(0x460f + c);
    this.wr(0xcb61, v);
    if (this.rd(0xcb4c)) return;
    this.wr(ff(0x25), (this.rd(ff(0x25)) & 0x77) | v);
  }

  /** 0F:4613 — A FC: one byte skipped. */
  private skip(): void {
    this.fetch();
  }

  /** 0F:4616 — `jr $4616`: the unused commands (A F8 FD; B F7 F8 FC FD; C F5 F7 FC FD; D 4 5 7 8
   *  C-F, E or F high nibble) lock the game up in the interrupt. */
  private hang(): void {
    throw new Error("sound driver: unused command, the original hangs (0F:4616 jr $4616)");
  }

  /** 0F:474B — a list step from the position at [hl+3..4]: a = ticks, hl after it; ticks 00:
   *  the list goes on at the address after it (one level). */
  private listStep(hl: number): { a: number; hl: number } {
    let p = this.word(hl + 3);
    let a = this.rd(p);
    p = (p + 1) & 0xffff;
    if (a) return { a, hl: p };
    p = this.word(p);
    a = this.rd(p);
    return { a, hl: (p + 1) & 0xffff };
  }

  /** The vibrato block of 0F:4634 / 4692 / 46ED: ticks [cnt] - 1; at 0 the next list step (ticks to
   *  [cnt], position to [cnt+3..4]), frequency = word[freq] + signed offset into NRx3 / NRx4 & 07
   *  (`reg` = NRx3). */
  private vibrato(cnt: number, freq: number, reg: number): void {
    const t = (this.rd(cnt) - 1) & 0xff;
    this.wr(cnt, t);
    if (t) return;
    const s = this.listStep(cnt);
    this.wr(cnt, s.a);
    const e = this.rd(s.hl);
    const hl = (s.hl + 1) & 0xffff;
    this.wr(cnt + 3, hl & 0xff);
    this.wr(cnt + 4, hl >> 8);
    const f = (this.word(freq) + (e & 0x80 ? e | 0xff00 : e)) & 0xffff;
    this.wr(ff(reg), f & 0xff);
    this.wr(ff(reg + 1), (f >> 8) & 0x07);
  }

  /** The envelope block of 0F:465F / 46BD: ticks [cnt] (FF: held) - 1; at 0 the next list step
   *  (ticks to [cnt]), NRx2 (`reg`) = its value, NRx4 = [hi] (the note's trigger byte), the
   *  position to [cnt+3..4]. */
  private envelope(cnt: number, reg: number, hi: number): void {
    if (this.rd(cnt) === 0xff) return;
    const t = (this.rd(cnt) - 1) & 0xff;
    this.wr(cnt, t);
    if (t) return;
    const s = this.listStep(cnt);
    this.wr(cnt, s.a);
    this.wr(ff(reg), this.rd(s.hl));
    const hl = (s.hl + 1) & 0xffff;
    this.wr(ff(reg + 2), this.rd(hi));
    this.wr(cnt + 3, hl & 0xff);
    this.wr(cnt + 4, hl >> 8);
  }

  /** 0F:4625 — channel A's vibrato (CB0E, NR23/24 from CB0C) and envelope (CB13, NR22, NR24 =
   *  CB0D), while it plays (CB05 = 0), FFBE is not 0 and the pitch is not D. */
  private updateA(): void {
    if (this.rd(0xcb05)) return;
    if (!this.hr(0xffbe)) return;
    if (this.rd(0xcb07) === 0x0d) return;
    this.vibrato(0xcb0e, 0xcb0c, 0x18);
    this.envelope(0xcb13, 0x17, 0xcb0d);
  }

  /** 0F:467D — channel B's vibrato (CB26, NR13/14 from CB24) and envelope (CB2B, NR12, NR14 =
   *  CB25), while no pulse effect plays and B plays (CB1C | CB1D = 0), FFBF is not 0, the pitch is
   *  not D and no pulse effect ran since the note (CB66). */
  private updateB(): void {
    if (this.rd(0xcb1c) | this.rd(0xcb1d)) return;
    if (!this.hr(0xffbf)) return;
    if (this.rd(0xcb1f) === 0x0d) return;
    if (this.rd(0xcb66)) return;
    this.vibrato(0xcb26, 0xcb24, 0x13);
    this.envelope(0xcb2b, 0x12, 0xcb25);
  }

  /** 0F:46DB — channel C's vibrato (CB3E, NR33/34 from CB3C; while C plays, FFC0 is not 0 and the
   *  pitch is not D); 0F:4718 — channel D's envelope (CB5B, FF held; NR42, NR44 = 80) while no
   *  noise effect plays and D plays (CB4C | CB4D = 0), FFC1 is not 0, the pitch is not D and (once
   *  the ticks are out) no noise effect ran since the note (CB67). */
  private updateCD(): void {
    if (!this.rd(0xcb35) && this.hr(0xffc0) && this.rd(0xcb37) !== 0x0d) {
      this.vibrato(0xcb3e, 0xcb3c, 0x1d);
    }
    // 4718
    if (this.rd(0xcb4c) | this.rd(0xcb4d)) return;
    if (!this.hr(0xffc1)) return;
    if (this.rd(0xcb4f) === 0x0d) return;
    if (this.rd(0xcb5b) === 0xff) return;
    const t = (this.rd(0xcb5b) - 1) & 0xff;
    this.wr(0xcb5b, t);
    if (t) return;
    if (this.rd(0xcb67)) return;
    const s = this.listStep(0xcb5b);
    this.wr(0xcb5b, s.a);
    this.wr(ff(0x21), this.rd(s.hl));
    const hl = (s.hl + 1) & 0xffff;
    this.wr(ff(0x23), 0x80);
    this.wr(0xcb5e, hl & 0xff);
    this.wr(0xcb5f, hl >> 8);
  }

  /** 0F:4759 — sound effect a: the pulse 1 effect at word 0F:66F2[a - 1] (unless its two bytes add
   *  up to 0 in 8 bits: CB62/63, CB1C = 1), the noise effect at word 0F:6774[a - 1] (likewise:
   *  CB64/65, CB4C = 1); FFBC = 0. */
  private effectRequest(a: number): void {
    const de = ((a - 1) * 2) & 0xff;
    let lo = this.rd(0x66f2 + de), c = this.rd(0x66f3 + de);
    if ((lo + c) & 0xff) {
      this.wr(0xcb62, lo);
      this.wr(0xcb63, c);
      this.wr(0xcb1c, 1);
    }
    lo = this.rd(0x6774 + de);
    c = this.rd(0x6775 + de);
    if ((lo + c) & 0xff) {
      this.wr(0xcb64, lo);
      this.wr(0xcb65, c);
      this.wr(0xcb4c, 1);
    }
    this.hw(0xffbc, 0);
  }

  /** 0F:478E — the sound effects: pulse 1 (CB1C ticks: CB66 = CB1C, CB1C - 1, at 0 the next step
   *  0F:479C), then noise (0F:47E0: CB4C, CB67, 0F:47EC). */
  private effects(): void {
    let a = this.rd(0xcb1c);
    if (a) {
      this.wr(0xcb66, a);
      a = (a - 1) & 0xff;
      this.wr(0xcb1c, a);
      if (a === 0) this.pulseStep();
    }
    a = this.rd(0xcb4c);
    if (!a) return;
    this.wr(0xcb67, a);
    a = (a - 1) & 0xff;
    this.wr(0xcb4c, a);
    if (a) return;
    this.noiseStep();
  }

  /** 0F:479C — the pulse effect's next step from CB62/63, each byte read into CB1C: 00 ends it
   *  (0F:40DD); EF lo hi loops back while FFC4 - 1 is not 0; Fx sets FFC4 = x; else ticks, then
   *  NR10-NR14, NR51 |= 11, the position back to CB62/63. */
  private pulseStep(): void {
    let hl = this.word(0xcb62);
    for (;;) {
      const a = this.rd(hl);
      hl = (hl + 1) & 0xffff;
      this.wr(0xcb1c, a);
      if (a === 0) { this.pulseBack(); return; }
      if (a === 0xef) {
        const c = this.rd(hl), b = this.rd(hl + 1);
        hl = (hl + 2) & 0xffff;
        const n = (this.hr(0xffc4) - 1) & 0xff;
        this.hw(0xffc4, n);
        if (n) hl = (b << 8) | c;
        continue;
      }
      if (a >= 0xf0) { this.hw(0xffc4, a & 0x0f); continue; }
      for (let r = 0x10; r < 0x15; r++) {
        this.wr(ff(r), this.rd(hl));
        hl = (hl + 1) & 0xffff;
      }
      this.wr(ff(0x25), this.rd(ff(0x25)) | 0x11);
      this.wr(0xcb62, hl & 0xff);
      this.wr(0xcb63, hl >> 8);
      return;
    }
  }

  /** 0F:47EC — the noise effect's next step from CB64/65, each byte read into CB4C: 00 ends it
   *  (0F:40FD); EF lo hi loops back while FFC5 - 1 is not 0 (0F:4802); Fx sets FFC5 = x; else
   *  ticks, then NR42, NR43, NR44 = 80, NR51 |= 88, the position back to CB64/65. */
  private noiseStep(): void {
    let hl = this.word(0xcb64);
    for (;;) {
      const a = this.rd(hl);
      hl = (hl + 1) & 0xffff;
      this.wr(0xcb4c, a);
      if (a === 0) { this.noiseBack(); return; }
      if (a === 0xef) {
        const c = this.rd(hl), b = this.rd(hl + 1);
        hl = (hl + 2) & 0xffff;
        const n = (this.hr(0xffc5) - 1) & 0xff;
        this.hw(0xffc5, n);
        if (n) hl = (b << 8) | c;
        continue;
      }
      if (a >= 0xf0) { this.hw(0xffc5, a & 0x0f); continue; }
      this.wr(ff(0x21), this.rd(hl));
      this.wr(ff(0x22), this.rd(hl + 1));
      hl = (hl + 2) & 0xffff;
      this.wr(ff(0x23), 0x80);
      this.wr(ff(0x25), this.rd(ff(0x25)) | 0x88);
      this.wr(0xcb64, hl & 0xff);
      this.wr(0xcb65, hl >> 8);
      return;
    }
  }
}
