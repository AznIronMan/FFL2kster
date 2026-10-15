"""Legend I copy of tools/trace_lib.py (ffl1kster.emu, ffl1/build/traces, the Legend I frame wait).

Lean PyBoy ground-truth traces for broad parity sweeps (same semantics as tools/trace_record.py,
compact storage). Per trace directory build/traces/NAME:
  start.bin     machine 8000-FFFF at the hook (registers in trace.json)
  trace.json    state, hook, pokes, plan, per-frame buttons and LCD registers ("lean": true)
  hram.bin      FF80-FFFF after every frame (128 bytes per frame)
  tick.bin      CEC2 (sound tempo accumulator, advanced by every frame tick) and C3A0 after every frame
  prev.bin      the screen of the frame before the hook (160x144 shades)
  screens.dx.gz 160x144 shade bytes per frame, each XORed with the previous frame, gzip
  waits.dx.gz   machine 8000-FFFF where every rst $10 ends (00:00CF, LY >= 0x90), each XORed with the previous
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
from ffl1kster.emu import Emulator

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


VW_SITES = ((0x007C, "hl"), (0x0085, "hl"), (0x0091, "de"), (0x009A, "de"), (0x1BD4, "hl"), (0x1BD7, "hl"))


# sync points: {"BB:AAAA": [[frame, LY], ...]} of each time the CPU reaches them (waits.json
# "points"): the wave's iteration start (00:3E35, FFCB = 0) and end (00:3E7B), the menu's
# window off (00:26F1)
POINTS = ((0x00, 0x3E35), (0x00, 0x3E7B), (0x00, 0x26F1))


class Recorder:
    def __init__(self, rom="ffl1/input/original.gb"):
        self.rom = rom
        self.e = Emulator(rom).__enter__()
        self.pb = self.e.pb

    def close(self):
        self.e.__exit__(None, None, None)

    def record(self, name, state, steps, hook=(0, 0x1A43), pokes=(), plan="", max_pre=3000, meta=None,
               marks=(), stop_after=None, switch=None, save=None):
        """Load STATE, run to HOOK (apply POKES there, snapshot), then one button set per frame."""
        pb = self.pb
        out = f"ffl1/build/traces/{name}"
        os.makedirs(out, exist_ok=True)
        if state == "boot":   # power-on: a fresh emulator (RNG counters from DIV as on hardware)
            self.e.close()
            self.e = Emulator(self.rom).__enter__()
            self.pb = pb = self.e.pb
        else:
            self.e.load_state(state if "/" in state else f"ffl1/build/states/{state}.state")
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
        # the VRAM bytes written inside the VRAM bracket (STAT jp at C39D -> 00:069F: the code runs in
        # each line's hblank) with the LCD on: [frame, LY, address] at the store of 00:007C / 0085
        # (fills, HL), 00:0091 / 009A (copies, DE) and 00:1BD4 / 1BD7 (the battle dissolve's masks, HL)
        vw = []

        def mk_vw(reg):
            def at_vw(_):
                if not start:
                    return
                m = pb.memory
                if m[0xC39E] != 0x9F or m[0xC39F] != 0x06 or not (m[0xFF40] & 0x80):
                    return
                r = pb.register_file
                a = r.HL if reg == "hl" else (r.D << 8 | r.E)
                if 0x8000 <= a < 0xA000:
                    vw.append([nframes[0], m[0xFF44], a])
            return at_vw
        # the field loop's direction read (00:209D, FF8D at 00:20A4): [frame, LY] of each call; read
        # after the next frame's tick (line 0), the original sees that frame's buttons
        polls = []

        def at_poll(_):
            if start:
                polls.append([nframes[0], pb.memory[0xFF44]])
        points = {f"{b:02X}:{a:04X}": [] for b, a in POINTS}

        def mk_point(b, a):
            def at_point(_):
                if start:
                    points[f"{b:02X}:{a:04X}"].append([nframes[0], pb.memory[0xFF44]])
                    if (b, a) == (0x00, 0x3E35):
                        wave_point[0] = points["00:3E35"][-1]
            return at_point
        # the wave's SCX writes (00:3E9B) PyBoy drew its line without: [frame, LY, LYC] of each
        # handler (for line LYC) whose value (A) is not the SCX PyBoy drew line LYC with
        # (tilemap_position_list, taken at its mode 0): the handler came a line late, or wrote
        # after PyBoy's draw moment (the end of mode 3, whose length depends on the line)
        wave_late = []
        wave_pending = []

        def at_wave_stat(_):
            if start:
                ly, lyc = pb.memory[0xFF44], pb.memory[0xFF45]
                if lyc < 0x90:
                    wave_pending.append((nframes[0], ly, lyc, pb.register_file.A))

        def wave_drawn():
            if wave_pending:
                pos = pb.screen.tilemap_position_list
                for fr, ly, lyc, a in wave_pending:
                    if pos[lyc][0] != a:
                        wave_late.append([fr, ly, lyc])
                wave_pending.clear()
        # the wave's table stores (00:3E4F, E = the byte) of a round whose first store came on a
        # drawn line (its start ran past the vblank): the stores race the beam, the STAT handler
        # reads each line's byte: {"p": [frame, LY] of its 00:3E35, "f": frame, "ly": [LY of
        # each store until the vblank]} (waits.json "waveStores")
        wave_stores = []
        wave_point = [None]

        def at_wave_store(_):
            if not start:
                return
            e, ly = pb.register_file.E, pb.memory[0xFF44]
            if e == 0:
                if ly < 0x90 and wave_point[0] is not None:
                    wave_stores.append({"p": wave_point[0], "f": nframes[0], "ly": [ly]})
                else:
                    wave_point[0] = None
            elif wave_point[0] is not None and wave_stores and wave_stores[-1]["p"] is wave_point[0] \
                    and ly < 0x90 and len(wave_stores[-1]["ly"]) == e:
                wave_stores[-1]["ly"].append(ly)
        hb, ha = hook
        pb.hook_register(hb, ha, cb, None)
        pb.hook_register(0, 0x3E4F, at_wave_store, None)
        pb.hook_register(0, 0x209D, at_poll, None)
        for b, a in POINTS:
            pb.hook_register(b, a, mk_point(b, a), None)
        pb.hook_register(0, 0x3E9B, at_wave_stat, None)
        for i, ((sb, sa), _st) in enumerate(switch):
            pb.hook_register(sb, sa, mk_switch(i), None)
        for mb, ma in marks:
            pb.hook_register(mb, ma, mk_mark(mb, ma), None)
        pb.hook_register(0, 0x00C7, arm, None)
        pb.hook_register(0, 0x00CF, at_halt, None)
        for a, reg in VW_SITES:
            pb.hook_register(0, a, mk_vw(reg), None)
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
            tick = bytearray()
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
                wave_drawn()
                nframes[0] += 1
                m = pb.memory
                screens.append(LUT[np.asarray(pb.screen.ndarray)[:, :, 0]].tobytes())
                hram += bytes(m[0xFF80:0x10000])
                tick += bytes([m[0xCEC2], m[0xC3A0]])  # sound tempo accumulator (advances per frame tick), joypad sample
                frames.append({"btn": b, "ff89": m[0xFF89], "ff8a": m[0xFF8A],
                               "lcd": [m[0xFF40], m[0xFF42], m[0xFF43], m[0xFF4A], m[0xFF4B], m[0xFF47], m[0xFF48], m[0xFF49]]})
                if stop_after is not None and mark_meta and len(frames) >= mark_meta[0]["frame"] + stop_after:
                    break
            for k in held:
                pb.button_release(k)
        finally:
            pb.hook_deregister(0, 0x00C7)
            pb.hook_deregister(0, 0x00CF)
            for a, _r in VW_SITES:
                pb.hook_deregister(0, a)
            pb.hook_deregister(0, 0x209D)
            pb.hook_deregister(0, 0x3E4F)
            for b, a in POINTS:
                pb.hook_deregister(b, a)
            pb.hook_deregister(0, 0x3E9B)
            for mb, ma in marks:
                pb.hook_deregister(mb, ma)
            for (sb, sa), _st in switch:
                pb.hook_deregister(sb, sa)
        if save:  # the emulator state at the end, for chained scenarios
            self.e.save_state(save if "/" in save else f"ffl1/build/states/{save}.state")
        if marks:
            open(f"{out}/marks.bin", "wb").write(bytes(mark_mem))
            json.dump({"marks": mark_meta}, open(f"{out}/marks.json", "w"))
        elif os.path.exists(f"{out}/marks.json"):
            os.replace(f"{out}/marks.json", f"{out}/marks.json.old")
        open(f"{out}/start.bin", "wb").write(start["mem"])
        open(f"{out}/hram.bin", "wb").write(bytes(hram))
        open(f"{out}/tick.bin", "wb").write(bytes(tick))
        open(f"{out}/prev.bin", "wb").write(prev)
        open(f"{out}/screens.dx.gz", "wb").write(_dx(screens, 160 * 144))
        open(f"{out}/waits.dx.gz", "wb").write(_dx(waits, 0x8000, start["mem"]))
        json.dump({"frames": wait_frames, "vw": vw, "polls": polls, "points": points, "waveLate": wave_late, "waveStores": wave_stores}, open(f"{out}/waits.json", "w"))
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
