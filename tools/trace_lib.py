"""Lean PyBoy ground-truth traces for broad parity sweeps (same semantics as tools/trace_record.py,
compact storage). Per trace directory build/traces/NAME:
  start.bin     machine 8000-FFFF at the hook (registers in trace.json)
  trace.json    state, hook, pokes, plan, per-frame buttons and LCD registers ("lean": true)
  hram.bin      FF80-FFFF after every frame (128 bytes per frame)
  prev.bin      the screen of the frame before the hook (160x144 shades)
  screens.dx.gz 160x144 shade bytes per frame, each XORed with the previous frame, gzip
  waits.dx.gz   machine 8000-FFFF where every rst $10 ends (00:00E4, vblank), each XORed with the previous
                one (the first with start.bin), gzip; waits.json lists the frame of each.
  marks.bin     with marks=[(bank, addr)]: machine 8000-FFFF each time the CPU reaches a mark after the
                start (marks.json: frame, waits recorded before it, address, registers); with
                stop_after=N the recording ends N frames after the first mark.
  With switch=[((bank, addr), steps), ...]: the first time the CPU reaches one of those addresses
  after the start, the rest of the button plan is replaced by its STEPS (a later switch replaces
  an earlier one; the frames actually played are what trace.json lists).
The emulator is reused across traces (`Recorder`), so a sweep runs in one process."""
import gzip, json, os, sys
import numpy as np
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator

LUT = np.zeros(256, dtype=np.uint8)
LUT[255], LUT[153], LUT[85], LUT[0] = 0, 1, 2, 3


def _dx(chunks, size, first=None):
    prev = np.zeros(size, dtype=np.uint8) if first is None else np.frombuffer(first, dtype=np.uint8)
    out = bytearray()
    for c in chunks:
        a = np.frombuffer(c, dtype=np.uint8)
        out += (a ^ prev).tobytes()
        prev = a
    return gzip.compress(bytes(out), 6)


class Recorder:
    def __init__(self, rom="input/original.gb"):
        self.e = Emulator(rom).__enter__()
        self.pb = self.e.pb

    def close(self):
        self.e.__exit__(None, None, None)

    def record(self, name, state, steps, hook=(0, 0x1A43), pokes=(), plan="", max_pre=3000, meta=None,
               marks=(), stop_after=None, switch=None):
        """Load STATE, run to HOOK (apply POKES there, snapshot), then one button set per frame."""
        pb = self.pb
        out = f"build/traces/{name}"
        os.makedirs(out, exist_ok=True)
        self.e.load_state(state if "/" in state else f"build/states/{state}.state")
        start, waits, wait_frames, armed, nframes = {}, [], [], [False], [0]

        def cb(_):
            if start:
                return
            for pk in pokes:
                a, v = pk[0], pk[1]
                mask = pk[2] if len(pk) > 2 else 0xFF  # (address, value[, mask])
                pb.memory[a] = (pb.memory[a] & ~mask & 0xFF) | (v & mask)
            r = pb.register_file
            start["regs"] = {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL, "sp": r.SP, "pc": r.PC}
            start["mem"] = bytes(pb.memory[0x8000:0x10000])
            start["frame"] = pb.frame_count
            start["ly"] = pb.memory[0xFF44]

        def arm(_):
            if start:
                armed[0] = True

        def at_halt(_):
            if armed[0]:
                armed[0] = False
                waits.append(bytes(pb.memory[0x8000:0x10000]))
                wait_frames.append(nframes[0])
        mark_mem, mark_meta = bytearray(), []

        def mk_mark(bank, addr):
            def at_mark(_):
                if not start:
                    return
                r = pb.register_file
                mark_mem.extend(bytes(pb.memory[0x8000:0x10000]))
                mark_meta.append({"frame": nframes[0], "waits": len(wait_frames), "at": f"{bank:02X}:{addr:04X}",
                                  "regs": {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL}})
            return at_mark
        switch = list(switch or [])
        switched = []  # [frame, steps] of the latest switch

        def mk_switch(i):
            def at_switch(_):
                if start and i not in fired:
                    fired.add(i)
                    switched[:] = [nframes[0], switch[i][1]]
            return at_switch
        fired = set()
        hb, ha = hook
        pb.hook_register(hb, ha, cb, None)
        for i, ((sb, sa), _st) in enumerate(switch):
            pb.hook_register(sb, sa, mk_switch(i), None)
        for mb, ma in marks:
            pb.hook_register(mb, ma, mk_mark(mb, ma), None)
        pb.hook_register(0, 0x00D9, arm, None)
        pb.hook_register(0, 0x00E4, at_halt, None)
        try:
            for _ in range(max_pre):
                pb.tick(1, True)
                if start:
                    break
            pb.hook_deregister(hb, ha)
            if not start:
                raise RuntimeError(f"{name}: hook {hb:02X}:{ha:04X} not reached")
            prev = LUT[np.asarray(pb.screen.ndarray)[:, :, 0]].tobytes()  # last frame before the hook
            screens, hram, frames, held = [], bytearray(), [], set()
            si = 0
            while True:
                if switched:
                    j = si - switched[0]
                    if j >= len(switched[1]):
                        break
                    b = switched[1][j]
                elif si < len(steps):
                    b = steps[si]
                else:
                    break
                si += 1
                want = set() if b == "none" else set(b.split("+"))
                for k in held - want:
                    pb.button_release(k)
                for k in want - held:
                    pb.button_press(k)
                held = want
                pb.tick(1, True)
                nframes[0] += 1
                m = pb.memory
                screens.append(LUT[np.asarray(pb.screen.ndarray)[:, :, 0]].tobytes())
                hram += bytes(m[0xFF80:0x10000])
                frames.append({"btn": b, "ff89": m[0xFF89], "ff8a": m[0xFF8A],
                               "lcd": [m[0xFF40], m[0xFF42], m[0xFF43], m[0xFF4A], m[0xFF4B], m[0xFF47], m[0xFF48], m[0xFF49]]})
                if stop_after is not None and mark_meta and len(frames) >= mark_meta[0]["frame"] + stop_after:
                    break
            for k in held:
                pb.button_release(k)
        finally:
            pb.hook_deregister(0, 0x00D9)
            pb.hook_deregister(0, 0x00E4)
            for mb, ma in marks:
                pb.hook_deregister(mb, ma)
            for (sb, sa), _st in switch:
                pb.hook_deregister(sb, sa)
        if marks:
            open(f"{out}/marks.bin", "wb").write(bytes(mark_mem))
            json.dump({"marks": mark_meta}, open(f"{out}/marks.json", "w"))
        elif os.path.exists(f"{out}/marks.json"):
            os.replace(f"{out}/marks.json", f"{out}/marks.json.old")
        open(f"{out}/start.bin", "wb").write(start["mem"])
        open(f"{out}/hram.bin", "wb").write(bytes(hram))
        open(f"{out}/prev.bin", "wb").write(prev)
        open(f"{out}/screens.dx.gz", "wb").write(_dx(screens, 160 * 144))
        open(f"{out}/waits.dx.gz", "wb").write(_dx(waits, 0x8000, start["mem"]))
        json.dump({"frames": wait_frames}, open(f"{out}/waits.json", "w"))
        json.dump({"lean": True, "state": state, "plan": plan, "hook": f"{hb:02X}:{ha:04X}",
                   "pokes": [f"{pk[0]:04X}={pk[1]:02X}" + (f"/{pk[2]:02X}" if len(pk) > 2 else "") for pk in pokes], "start": {k: v for k, v in start.items() if k != "mem"},
                   "frames": frames, **(meta or {})}, open(f"{out}/trace.json", "w"))
        return len(frames), len(wait_frames)


def plan_steps(plan):
    steps = []
    for item in plan.split(","):
        b, n = item.split(":")
        steps += [b] * int(n)
    return steps
