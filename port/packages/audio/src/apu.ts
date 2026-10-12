/** A DMG APU model: the four sound channels driven by writes to FF10-FF3F with CPU-cycle time
 *  stamps, rendered to stereo Float32 PCM at any sample rate. Pure and deterministic (no DOM).
 *
 *  Time base: CPU cycles at 4194304 Hz (one video frame = 70224 cycles). `write(reg, v, cycle)`
 *  first runs the synthesis up to `cycle`, then applies the write, so writes must come in time
 *  order; `runUntil(cycle)` advances and `take()` returns the samples made so far (interleaved
 *  L/R). Each output sample is the exact average of the channel outputs over its time span
 *  (box filter, which removes most aliasing of the square waves), followed by the DMG's output
 *  high-pass ("capacitor") filter.
 *
 *  Hardware behaviour modelled (Pan Docs): pulse 1 with frequency sweep (overflow check, negate
 *  quirk), pulse 2, wave (32 4-bit samples, volume shift, DAC NR30), noise (15/7-bit LFSR,
 *  divisor/shift clock), length counters (incl. the extra clock when length is enabled in the
 *  first half of a sequencer period), envelopes, the 512 Hz frame sequencer, trigger semantics,
 *  DAC on/off (NRx2 & 0xF8, NR30 bit 7), NR50 master volume, NR51 panning, NR52 power (writes
 *  ignored while off, except NRx1 lengths). Not modelled: DIV-synchronised frame sequencer
 *  phase, wave-RAM access timing while CH3 plays, the "zombie mode" NRx2 glitches, Vin. */

export const CPU_HZ = 4194304;
export const FRAME_CYCLES = 70224;
const SEQ_CYCLES = 8192;

const DUTY = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
] as const;
const NOISE_DIV = [8, 16, 32, 48, 64, 80, 96, 112] as const;
/** Bits that read back as 1 (FF10-FF25). */
const READ_MASK = [
  0x80, 0x3f, 0x00, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff,
  0x9f, 0xff, 0xbf, 0xff, 0xff, 0x00, 0x00, 0xbf, 0x00, 0x00,
] as const;

/** "dmg": bipolar DAC outputs, NR50 volume, high-pass filter (what the speaker gets).
 *  "digital": the unipolar sum of the routed channels' 4-bit outputs (0-60) without NR50 or
 *  filtering, the way PyBoy builds its buffer; for analysis/comparison. */
export type ApuMode = "dmg" | "digital";

export interface ApuOptions {
  sampleRate?: number;
  mode?: ApuMode;
  /** Output gain in "dmg" mode (1 = full scale for all four channels at maximum). */
  gain?: number;
}

/** Volume envelope shared by the pulse and noise channels. */
class Envelope {
  initial = 0;
  up = false;
  pace = 0;
  volume = 0;
  timer = 0;
  setReg(v: number): void {
    this.initial = v >> 4;
    this.up = (v & 8) !== 0;
    this.pace = v & 7;
  }
  get reg(): number {
    return (this.initial << 4) | (this.up ? 8 : 0) | this.pace;
  }
  trigger(): void {
    this.volume = this.initial;
    this.timer = this.pace;
  }
  clock(): void {
    if (this.timer === 0) return;
    if (--this.timer === 0) {
      const n = this.volume + (this.up ? 1 : -1);
      if (n < 0 || n > 15) return; // stays; timer 0 stops it
      this.volume = n;
      this.timer = this.pace;
    }
  }
}

abstract class Channel {
  enabled = false;
  dac = false;
  length = 0;
  lengthEnable = false;
  /** Cycles until the next waveform step; period in cycles. */
  timer = 0;
  period = 8192;
  abstract readonly maxLength: number;
  /** Current 4-bit output (0-15) while enabled. */
  abstract digital(): number;
  /** Waveform positions per period and the output at position k (for the short-period fast
   *  path); 0 when the output is not periodic. */
  protected abstract positions(): number;
  protected abstract digitalAt(k: number): number;
  protected abstract step(): void;
  /** Integral over dt cycles of the channel's level: in "dmg" mode the DAC output d/7.5 - 1
   *  (0 with the DAC off; a disabled channel with its DAC on sits at -1), else the 4-bit value. */
  integrate(dt: number, dmg: boolean): number {
    if (!this.enabled) return dmg && this.dac ? -dt : 0;
    const lv = dmg ? (d: number) => d / 7.5 - 1 : (d: number) => d;
    let acc = 0, rem = dt;
    const n = this.positions();
    if (n && this.period * n * 2 <= rem) {
      // whole waveform periods average out and leave the state unchanged
      const whole = this.period * n;
      let sum = 0;
      for (let k = 0; k < n; k++) sum += lv(this.digitalAt(k));
      const c = Math.floor(rem / whole);
      acc += sum * this.period * c;
      rem -= whole * c;
    }
    while (rem > 0) {
      const s = this.timer < rem ? this.timer : rem;
      acc += lv(this.digital()) * s;
      this.timer -= s;
      rem -= s;
      if (this.timer <= 0) {
        this.step();
        this.timer += this.period;
      }
    }
    return acc;
  }
  clockLength(): void {
    if (this.lengthEnable && this.length > 0 && --this.length === 0) this.enabled = false;
  }
}

class Pulse extends Channel {
  readonly maxLength = 64;
  duty = 0;
  pos = 0;
  freq = 0;
  env = new Envelope();
  // sweep (pulse 1 only)
  readonly hasSweep: boolean;
  sweepPace = 0;
  sweepNeg = false;
  sweepShift = 0;
  sweepTimer = 0;
  sweepOn = false;
  shadow = 0;
  negUsed = false;
  constructor(hasSweep: boolean) {
    super();
    this.hasSweep = hasSweep;
  }
  digital(): number {
    return DUTY[this.duty]![this.pos]! * this.env.volume;
  }
  protected positions(): number {
    return 8;
  }
  protected digitalAt(k: number): number {
    return DUTY[this.duty]![k]! * this.env.volume;
  }
  protected step(): void {
    this.pos = (this.pos + 1) & 7;
  }
  setFreq(f: number): void {
    this.freq = f & 0x7ff;
    this.period = (2048 - this.freq) * 4;
  }
  trigger(): void {
    this.enabled = this.dac;
    if (this.length === 0) this.length = 64;
    this.timer = this.period;
    this.env.trigger();
    if (this.hasSweep) {
      this.shadow = this.freq;
      this.sweepTimer = this.sweepPace || 8;
      this.sweepOn = this.sweepPace !== 0 || this.sweepShift !== 0;
      this.negUsed = false;
      if (this.sweepShift) this.sweepCalc();
    }
  }
  sweepCalc(): number {
    let n = this.shadow >> this.sweepShift;
    if (this.sweepNeg) {
      n = this.shadow - n;
      this.negUsed = true;
    } else n = this.shadow + n;
    if (n > 0x7ff) this.enabled = false;
    return n;
  }
  clockSweep(): void {
    if (--this.sweepTimer > 0) return;
    this.sweepTimer = this.sweepPace || 8;
    if (!this.sweepOn || !this.sweepPace || !this.enabled) return;
    const n = this.sweepCalc();
    if (n <= 0x7ff && this.sweepShift) {
      this.shadow = n;
      this.setFreq(n);
      this.sweepCalc();
    }
  }
}

class Wave extends Channel {
  readonly maxLength = 256;
  freq = 0;
  pos = 0;
  shift = 4; // volume code → right shift (4 = mute)
  volCode = 0;
  ram = new Uint8Array(16);
  /** After a trigger the channel outputs nothing until its first step (DMG start delay). */
  starting = false;
  digital(): number {
    return this.starting ? 0 : this.digitalAt(this.pos);
  }
  protected positions(): number {
    return this.starting ? 0 : 32;
  }
  protected digitalAt(k: number): number {
    const b = this.ram[k >> 1]!;
    return ((k & 1 ? b : b >> 4) & 0x0f) >> this.shift;
  }
  protected step(): void {
    this.pos = (this.pos + 1) & 31;
    this.starting = false;
  }
  setFreq(f: number): void {
    this.freq = f & 0x7ff;
    this.period = (2048 - this.freq) * 2;
  }
  trigger(): void {
    this.enabled = this.dac;
    if (this.length === 0) this.length = 256;
    this.pos = 0;
    this.timer = this.period + 6;
    this.starting = true;
  }
}

class Noise extends Channel {
  readonly maxLength = 64;
  env = new Envelope();
  lfsr = 0x7fff;
  shiftClk = 0;
  narrow = false;
  div = 0;
  nr43 = 0;
  digital(): number {
    return this.lfsr & 1 ? 0 : this.env.volume;
  }
  protected positions(): number {
    return 0;
  }
  protected digitalAt(): number {
    return 0;
  }
  protected step(): void {
    if (this.shiftClk >= 14) return; // no clocks on the hardware
    const x = (this.lfsr ^ (this.lfsr >> 1)) & 1;
    this.lfsr = (this.lfsr >> 1) | (x << 14);
    if (this.narrow) this.lfsr = (this.lfsr & ~0x40) | (x << 6);
  }
  setReg43(v: number): void {
    this.nr43 = v;
    this.shiftClk = v >> 4;
    this.narrow = (v & 8) !== 0;
    this.div = v & 7;
    this.period = NOISE_DIV[this.div]! << this.shiftClk;
  }
  trigger(): void {
    this.enabled = this.dac;
    if (this.length === 0) this.length = 64;
    this.timer = this.period;
    this.env.trigger();
    this.lfsr = 0x7fff;
  }
}

export class Apu {
  sampleRate: number;
  readonly mode: ApuMode;
  gain: number;
  /** Per-channel mute (pulse 1, pulse 2, wave, noise), for debugging/analysis. */
  readonly mute = [false, false, false, false];
  private cps: number; // cycles per sample
  private readonly ch1 = new Pulse(true);
  private readonly ch2 = new Pulse(false);
  private readonly ch3 = new Wave();
  private readonly ch4 = new Noise();
  private readonly chans: Channel[];
  private power = false;
  private nr50 = 0;
  private nr51 = 0;
  private readonly regs = new Uint8Array(0x30);
  private now = 0;
  private seqNext = SEQ_CYCLES;
  private seqStep = 0;
  private sampleNext: number;
  private readonly acc = new Float64Array(4);
  private capL = 0;
  private capR = 0;
  private charge: number;
  private out = new Float32Array(4096);
  private outN = 0; // floats in `out`

  constructor(opts: ApuOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.mode = opts.mode ?? "dmg";
    this.gain = opts.gain ?? 1;
    this.cps = CPU_HZ / this.sampleRate;
    this.sampleNext = this.cps;
    this.charge = Math.pow(0.999958, this.cps);
    this.chans = [this.ch1, this.ch2, this.ch3, this.ch4];
  }

  /** Change the output rate (e.g. to the AudioContext's) without touching the APU state. */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.cps = CPU_HZ / rate;
    this.sampleNext = this.now + this.cps;
    this.acc.fill(0);
    this.charge = Math.pow(0.999958, this.cps);
  }

  /** Current time in CPU cycles. */
  get cycle(): number {
    return this.now;
  }

  /** Register write (reg = 0xFF10-0xFF3F or 0x10-0x3F) at `cycle` (default: now). */
  write(reg: number, v: number, cycle?: number): void {
    if (cycle !== undefined && cycle > this.now) this.runUntil(cycle);
    this.apply(reg & 0xff, v & 0xff);
  }

  /** Register read (with the hardware's unreadable bits set). */
  read(reg: number): number {
    const r = reg & 0xff;
    if (r === 0x26) {
      let v = 0x70 | (this.power ? 0x80 : 0);
      this.chans.forEach((c, i) => { if (c.enabled) v |= 1 << i; });
      return v;
    }
    if (r >= 0x30 && r < 0x40) return this.ch3.ram[r - 0x30]!;
    if (r < 0x10 || r > 0x25) return 0xff;
    return this.regs[r - 0x10]! | READ_MASK[r - 0x10]!;
  }

  /** Advance the synthesis to `cycle`, producing samples. */
  runUntil(cycle: number): void {
    while (this.now < cycle) {
      let end = cycle;
      if (this.seqNext < end) end = this.seqNext;
      if (this.sampleNext < end) end = this.sampleNext;
      const dt = end - this.now;
      if (dt > 0) this.integrate(dt);
      this.now = end;
      if (this.now >= this.seqNext) {
        this.sequencer();
        this.seqNext += SEQ_CYCLES;
      }
      if (this.now >= this.sampleNext) {
        this.emit();
        this.sampleNext += this.cps;
      }
    }
  }

  /** Render exactly `frames` more stereo frames (advancing time) and return them interleaved,
   *  together with any samples already pending. */
  render(frames: number): Float32Array {
    const want = this.outN + 2 * frames;
    while (this.outN < want) this.runUntil(this.sampleNext);
    return this.take();
  }

  /** Samples produced so far (interleaved L/R), clearing the internal buffer. */
  take(): Float32Array {
    const r = this.out.slice(0, this.outN);
    this.outN = 0;
    return r;
  }

  // ------------------------------------------------------------------ internals

  private apply(r: number, v: number): void {
    if (r >= 0x30 && r < 0x40) {
      this.ch3.ram[r - 0x30] = v;
      return;
    }
    if (r < 0x10 || r > 0x26) return;
    if (r === 0x26) {
      const on = (v & 0x80) !== 0;
      if (!on && this.power) {
        for (let a = 0x10; a < 0x26; a++) this.apply(a, 0);
        this.chans.forEach((c) => (c.enabled = false));
      }
      if (on && !this.power) {
        this.seqStep = 0;
        this.seqNext = this.now + SEQ_CYCLES;
      }
      this.power = on;
      this.regs[0x16] = v & 0x80;
      return;
    }
    if (!this.power && !(r === 0x11 || r === 0x16 || r === 0x1b || r === 0x20)) return;
    if (!this.power) {
      // DMG: lengths stay writable while off
      if (r === 0x1b) this.ch3.length = 256 - v;
      else (r === 0x11 ? this.ch1 : r === 0x16 ? this.ch2 : this.ch4).length = 64 - (v & 0x3f);
      return;
    }
    this.regs[r - 0x10] = v;
    const c1 = this.ch1, c2 = this.ch2, c3 = this.ch3, c4 = this.ch4;
    switch (r) {
      case 0x10: {
        const wasNeg = c1.sweepNeg;
        c1.sweepPace = (v >> 4) & 7;
        c1.sweepNeg = (v & 8) !== 0;
        c1.sweepShift = v & 7;
        if (wasNeg && !c1.sweepNeg && c1.negUsed) c1.enabled = false;
        return;
      }
      case 0x11: case 0x16: {
        const c = r === 0x11 ? c1 : c2;
        c.duty = v >> 6;
        c.length = 64 - (v & 0x3f);
        return;
      }
      case 0x12: case 0x17: case 0x21: {
        const c = r === 0x12 ? c1 : r === 0x17 ? c2 : c4;
        c.env.setReg(v);
        c.dac = (v & 0xf8) !== 0;
        if (!c.dac) c.enabled = false;
        return;
      }
      case 0x13: case 0x18: {
        const c = r === 0x13 ? c1 : c2;
        c.setFreq((c.freq & 0x700) | v);
        return;
      }
      case 0x14: case 0x19: {
        const c = r === 0x14 ? c1 : c2;
        c.setFreq((c.freq & 0xff) | ((v & 7) << 8));
        this.nrx4(c, v, () => c.trigger());
        return;
      }
      case 0x1a:
        c3.dac = (v & 0x80) !== 0;
        if (!c3.dac) c3.enabled = false;
        return;
      case 0x1b:
        c3.length = 256 - v;
        return;
      case 0x1c:
        c3.volCode = (v >> 5) & 3;
        c3.shift = c3.volCode ? c3.volCode - 1 : 4;
        return;
      case 0x1d:
        c3.setFreq((c3.freq & 0x700) | v);
        return;
      case 0x1e:
        c3.setFreq((c3.freq & 0xff) | ((v & 7) << 8));
        this.nrx4(c3, v, () => c3.trigger());
        return;
      case 0x20:
        c4.length = 64 - (v & 0x3f);
        return;
      case 0x22:
        c4.setReg43(v);
        return;
      case 0x23:
        this.nrx4(c4, v, () => c4.trigger());
        return;
      case 0x24:
        this.nr50 = v;
        return;
      case 0x25:
        this.nr51 = v;
        return;
    }
  }

  /** NRx4: length enable with the extra length clock, then trigger. */
  private nrx4(c: Channel, v: number, trigger: () => void): void {
    const was = c.lengthEnable;
    c.lengthEnable = (v & 0x40) !== 0;
    const oddPhase = (this.seqStep & 1) === 1; // next step does not clock lengths
    if (oddPhase && !was && c.lengthEnable && c.length > 0) {
      if (--c.length === 0 && !(v & 0x80)) c.enabled = false;
    }
    if (v & 0x80) {
      const wasZero = c.length === 0;
      trigger();
      if (wasZero && oddPhase && c.lengthEnable) c.length = c.maxLength - 1;
    }
  }

  private sequencer(): void {
    const s = this.seqStep;
    this.seqStep = (s + 1) & 7;
    if (!this.power) return;
    if ((s & 1) === 0) for (const c of this.chans) c.clockLength();
    if (s === 2 || s === 6) this.ch1.clockSweep();
    if (s === 7) {
      this.ch1.env.clock();
      this.ch2.env.clock();
      this.ch4.env.clock();
    }
  }

  private integrate(dt: number): void {
    if (!this.power) return;
    const dmg = this.mode === "dmg";
    for (let i = 0; i < 4; i++) this.acc[i]! += this.chans[i]!.integrate(dt, dmg);
  }

  private emit(): void {
    const inv = 1 / this.cps;
    let l = 0, r = 0;
    const p = this.nr51;
    for (let i = 0; i < 4; i++) {
      const v = this.mute[i] ? 0 : this.acc[i]!;
      this.acc[i] = 0;
      if (p & (0x10 << i)) l += v;
      if (p & (1 << i)) r += v;
    }
    l *= inv;
    r *= inv;
    if (this.mode === "dmg") {
      l *= (((this.nr50 >> 4) & 7) + 1) / 8 / 4;
      r *= ((this.nr50 & 7) + 1) / 8 / 4;
      const ol = l - this.capL;
      this.capL = l - ol * this.charge;
      const or = r - this.capR;
      this.capR = r - or * this.charge;
      l = ol * this.gain;
      r = or * this.gain;
    }
    if (this.outN + 2 > this.out.length) {
      const n = new Float32Array(this.out.length * 2);
      n.set(this.out);
      this.out = n;
    }
    this.out[this.outN++] = l;
    this.out[this.outN++] = r;
  }
}
