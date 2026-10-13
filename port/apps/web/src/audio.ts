/** Sound output for the player: the engine's sound-register writes (Memory.onSoundWrite) feed a
 *  DMG APU model (@ffl2k/audio); after every video frame the PCM made for that frame is posted to
 *  an AudioWorklet that plays it from a small ring buffer. Audio starts on the first user gesture
 *  (browser autoplay rules); 'M' toggles mute. */
import { Apu, FRAME_CYCLES } from "@ffl2k/audio";
import type { Game } from "@ffl2k/core";

const LINE_CYCLES = 456;
/** Ring buffer: target and maximum queued audio (seconds). */
const TARGET_S = 0.08, MAX_S = 0.25;

const WORKLET = `
class FflOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.off = 0; this.n = 0; this.started = false;
    this.target = Math.round(${TARGET_S} * sampleRate); this.max = Math.round(${MAX_S} * sampleRate);
    this.port.onmessage = (e) => {
      if (e.data === "clear") { this.q = []; this.off = 0; this.n = 0; this.started = false; return; }
      this.q.push(e.data); this.n += e.data.length / 2;
      while (this.n > this.max && this.q.length > 1) { const d = this.q.shift(); this.n -= (d.length - this.off) / 2; this.off = 0; }
    };
  }
  process(_in, outs) {
    const l = outs[0][0], r = outs[0][1] || outs[0][0];
    if (!this.started && this.n >= this.target) this.started = true;
    for (let i = 0; i < l.length; i++) {
      if (!this.started || !this.q.length) { l[i] = 0; r[i] = 0; continue; }
      const d = this.q[0];
      l[i] = d[this.off]; r[i] = d[this.off + 1];
      this.off += 2; this.n--;
      if (this.off >= d.length) { this.q.shift(); this.off = 0; }
    }
    if (!this.q.length) this.started = false;
    return true;
  }
}
registerProcessor("ffl-out", FflOut);
`;

export class AudioOut {
  readonly apu = new Apu({ sampleRate: 48000, gain: 0.6 });
  muted = false;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting = false;
  private k = 0;

  /** Route a Game's sound-register writes into the APU. Time stamps: the port runs a frame from
   *  vblank (LY 144) on, so a write at line LY is (LY - 144 mod 154) lines into the frame; writes
   *  within a line are spaced 16 cycles apart, in order. */
  attach(g: Game): void {
    let lastLy = -1;
    g.m.onSoundWrite = (reg, v) => {
      const ly = g.m.io[0x44]!;
      if (ly !== lastLy) { lastLy = ly; this.k = 0; }
      const line = (ly - 144 + 154) % 154;
      this.apu.write(reg, v, g.frame * FRAME_CYCLES + line * LINE_CYCLES + 16 * this.k++);
    };
  }

  /** After the engine ran up to (not including) video frame `frame`: synthesize to that point and
   *  hand the samples to the audio thread. */
  endFrame(frame: number, speed = 1): void {
    this.apu.runUntil(frame * FRAME_CYCLES);
    let pcm = this.apu.take();
    if (speed > 1) pcm = this.decimate(pcm, speed);
    if (this.node && !this.muted && pcm.length) this.node.port.postMessage(pcm, [pcm.buffer]);
  }

  /** Fast-forward / battle speed: keep every n-th stereo sample frame, so sound keeps pace with
   *  the game (faster and higher, as on emulators) instead of piling up. */
  private phase = 0;
  private decimate(pcm: Float32Array, n: number): Float32Array {
    const frames = pcm.length >> 1;
    const out = new Float32Array(2 * Math.ceil(frames / n) + 2);
    let o = 0;
    for (let i = 0; i < frames; i++) {
      if (this.phase++ % n === 0) {
        out[o++] = pcm[2 * i]!;
        out[o++] = pcm[2 * i + 1]!;
      }
    }
    return out.subarray(0, o).slice();
  }

  /** Create the audio graph (call from a user gesture). */
  async start(): Promise<void> {
    if (this.ctx || this.starting) return;
    this.starting = true;
    try {
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
      } catch {
        ctx = new AudioContext({ latencyHint: "interactive" });
      }
      this.ctx = ctx;
      if (!ctx.audioWorklet) {
        console.warn("AudioWorklet unavailable (needs a secure context); sound is off.");
        return;
      }
      if (ctx.sampleRate !== this.apu.sampleRate) this.apu.setSampleRate(ctx.sampleRate);
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(ctx, "ffl-out", { numberOfInputs: 0, outputChannelCount: [2] });
      this.node.connect(ctx.destination);
      await ctx.resume();
    } catch (e) {
      console.warn("audio start failed", e);
    } finally {
      this.starting = false;
    }
  }

  /** Pause the audio device while the app is hidden (mobile lifecycle); resume on return. */
  async suspend(): Promise<void> {
    await this.ctx?.suspend().catch(() => {});
    this.node?.port.postMessage("clear");
  }

  async resume(): Promise<void> {
    await this.ctx?.resume().catch(() => {});
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) this.node?.port.postMessage("clear");
    return this.muted;
  }
}
