"""Legend III copy of tools/ffl1/trace_lib.py (ffl3kster.emu, ffl3/build/traces, the Legend III frame wait).

Lean PyBoy ground-truth traces for broad parity sweeps (same semantics as tools/trace_record.py,
compact storage). Per trace directory build/traces/NAME:
  start.bin     machine 8000-FFFF at the hook (registers in trace.json)
  trace.json    state, hook, pokes, plan, per-frame buttons and LCD registers ("lean": true)
  hram.bin      FF80-FFFF after every frame (128 bytes per frame)
  oam.bin       FE00-FE9F after every frame (160 bytes per frame)
  waits.json    also "syncs": the frame of every end of the VRAM bracket's mode-1 poll (00:1E35, after
                00:1D9E / 00:1DFD), which the port's replay aligns its own polls to, and "polls": [frame, LY]
                of every entry to 00:1D9E / 00:1DFD (di: the interrupts stay off until the poll's reti), and
                "works": [frame, LY, end frame, end LY(, di frame, di LY)] of every run of the frame work 00:3557
                (from 00:3549, CDC5 0 -> 1; it ends back at 00:3552; the field branch's di at 00:356B, after
                which an interrupt waits), whose hblank-paced VRAM copies span lines, and
                "starts": [frame, LY] at which each frame wait began (00:3A6D), "ends": [frame, LY] at which
                each ended (00:3A77, the code resumed; diagnostic: a long vblank handler resumes it in the next
                frame), and "points": {"BB:AAAA":
                [[frame, LY], ...]} of the times the CPU reached the addresses in POINTS (sync points: the port
                spends the CPU time before them, e.g. 00:1E49, a menu drawn after hblank-paced copies), and
                "rand": [frame, LY, FF93] at every call of the random generator 00:39D5, taken at its read
                of FF93 (00:39D8), and "paced": [frame, LY, de, n] at every chunk the hblank copy 00:20FF
                writes: n = 5 at 00:2120 (written again on the next line when the hblank ended meanwhile),
                n = 1 for each byte of its last 1-4 at 00:216E
  tick.bin      CB00 (the music tempo accumulator, advanced by every sound tick) and FF93 (the vblank frame
                counter) after every frame
  prev.bin      the screen of the frame before the hook (160x144 shades)
  screens.dx.gz 160x144 shade bytes per frame, each XORed with the previous frame, gzip
  waits.dx.gz   machine 8000-FFFF where every frame wait ends (00:3A77: FF95 counted down to 0 by the
                vblank handler after 00:3A6D set it), each XORed with the previous
                one (the first with start.bin), gzip; waits.json lists the frame of each (the frame of the vblank
                interrupt that ended it: a long vblank handler may resume the main in the next frame).
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
from ffl3kster.emu import Emulator

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
    def __init__(self, rom="ffl3/input/original.gb"):
        self.rom = rom
        self.e = Emulator(rom).__enter__()
        self.pb = self.e.pb

    def close(self):
        self.e.__exit__(None, None, None)

    def record(self, name, state, steps, hook=(1, 0x7C79), pokes=(), plan="", max_pre=3000, meta=None,
               marks=(), stop_after=None, switch=None, save=None, hook_vblank=False, wait_pokes=()):
        """Load STATE, run to HOOK (apply POKES there, snapshot), then one button set per frame.
        WAIT_POKES: ((n, pokes), ...) applied as frame wait n ends, after its snapshot (the replay
        applies them to the port at the same wait, after comparing it); n = ("frame", f): the first
        wait that ends in frame f or later (trace.json keeps the wait's number)."""
        wait_pokes = [list(wp) for wp in wait_pokes]
        pb = self.pb
        out = f"ffl3/build/traces/{name}"
        os.makedirs(out, exist_ok=True)
        if state.split(":")[0] == "boot":   # power-on: a fresh emulator (RNG counters from DIV as on hardware)
            self.e.close()
            self.e = Emulator(self.rom).__enter__()
            self.pb = pb = self.e.pb
            if ":" in state:   # "boot:NAME": the cartridge RAM trace NAME ended with (a saved game)
                if state.endswith(".sav"):   # "boot:FILE.sav": a player's battery save (.private/saves, local)
                    ram = open(f".private/saves/{state[5:]}", "rb").read()[:0x2000]
                else:
                    ram = open(f"ffl3/build/traces/{state[5:]}/sram.bin", "rb").read()[0x2000:]
                for i, v in enumerate(ram):
                    pb.memory[0, 0xA000 + i] = v
        else:
            self.e.load_state(state if "/" in state else f"ffl3/build/states/{state}.state")
        start, waits, wait_frames, armed, nframes = {}, [], [], [False], [0]

        def cb(_):
            if start:
                return
            if hook_vblank and pb.memory[0xFF44] < 144:   # a start right after a vblank (as field_start's)
                return
            for pk in pokes:
                a, v = pk[0], pk[1]
                mask = pk[2] if len(pk) > 2 else 0xFF  # (address, value[, mask])
                pb.memory[a] = (pb.memory[a] & ~mask & 0xFF) | (v & mask)
            r = pb.register_file
            start["regs"] = {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL, "sp": r.SP, "pc": r.PC}
            start["mem"] = bytes(pb.memory[0x8000:0x10000])
            start["sram"] = _sram(pb)
            start["frame"] = pb.frame_count
            start["ly"] = pb.memory[0xFF44]

        wait_starts, wait_ends, arm_at = [], [], [None]

        arm_vbl = [0]

        def arm(_):
            if start:
                armed[0] = True
                arm_vbl[0] = last_vbl[1]
                arm_at[0] = [nframes[0] if recording[0] else -1, pb.memory[0xFF44]]

        syncs, recording = [], [False]

        def at_sync(_):
            if start:
                syncs.append(nframes[0] if recording[0] else -1)  # -1: the rest of the hook's frame

        polls = []
        rand = []

        def at_rand(_):
            if start:
                rand.append([nframes[0] if recording[0] else -1, pb.memory[0xFF44], pb.memory[0xFF93]])
        points = {f"{b:02X}:{a:04X}": [] for b, a in POINTS}

        def mk_point(b, a):
            def at_point(_):
                if start:
                    points[f"{b:02X}:{a:04X}"].append([nframes[0] if recording[0] else -1, pb.memory[0xFF44]])
            return at_point

        def at_poll(_):
            if start:
                polls.append([nframes[0] if recording[0] else -1, pb.memory[0xFF44]])

        sfx = []

        def at_sfx(_):
            if start:
                sfx.append([nframes[0] if recording[0] else -1, pb.memory[0xFF44]])

        song = []
        stat = []

        def at_stat(_):   # 00:1F27, the bracket's STAT handler (LYC 3) entered
            if start:
                stat.append([nframes[0] if recording[0] else -1, pb.memory[0xFF44]])

        paced = []

        def at_paced(n):   # 00:2120 / 00:216E, a chunk of the hblank copy 00:20FF written (de its first byte)
            if start:
                rf = pb.register_file
                paced.append([nframes[0] if recording[0] else -1, pb.memory[0xFF44], rf.D << 8 | rf.E, n])

        def at_store(_):   # 0C:403A / 403D / 403F, the battle script's store writing a byte (to hl):
            # a request when it is FFBC / FFBA (taken at the write: an interrupt may come after 0C:4017)
            if start and pb.register_file.HL == 0xFFBC:
                sfx.append([nframes[0] if recording[0] else -1, pb.memory[0xFF44]])
            if start and pb.register_file.HL == 0xFFBA:
                song.append([nframes[0] if recording[0] else -1, pb.memory[0xFF44]])

        works, open_work = [], []

        def at_work(_):
            if start:
                open_work[:] = [nframes[0] if recording[0] else -1, pb.memory[0xFF44]]

        work_di = []

        def at_work_di(_):
            if start and open_work and pb.memory[0xCDC5] == 1:
                work_di[:] = [nframes[0] if recording[0] else -1, pb.memory[0xFF44]]

        def at_work_end(_):
            if start and open_work and pb.memory[0xCDC5] == 1:
                works.append(open_work + [nframes[0] if recording[0] else -1, pb.memory[0xFF44]] + work_di)
                open_work.clear()
                work_di.clear()

        last_vbl = [None, 0]  # frame of the latest vblank interrupt (00:0040), count of them

        def at_vbl(_):
            last_vbl[0] = nframes[0]
            last_vbl[1] += 1

        def at_halt(_):
            if armed[0]:
                armed[0] = False
                waits.append(bytes(pb.memory[0x8000:0x10000]))
                # the frame of the vblank that ended the wait (its handler may run past the frame's end,
                # e.g. a long vblank tile list or sound tick: the main then resumes in the next frame)
                f = nframes[0]
                if recording[0] and last_vbl[1] != arm_vbl[0]:
                    f = last_vbl[0]
                wait_frames.append(f)
                wait_starts.append(arm_at[0])
                wait_ends.append([nframes[0], pb.memory[0xFF44]])
                for wp in wait_pokes:
                    if isinstance(wp[0], tuple) and recording[0] and f >= wp[0][1]:
                        wp[0] = len(waits) - 1
                    n, pks = wp
                    if n == len(waits) - 1:
                        for pk in pks:
                            mask = pk[2] if len(pk) > 2 else 0xFF
                            pb.memory[pk[0]] = (pb.memory[pk[0]] & ~mask & 0xFF) | (pk[1] & mask)
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
        pb.hook_register(0, 0x3A6D, arm, None)
        pb.hook_register(0, 0x3A77, at_halt, None)
        pb.hook_register(0, 0x0040, at_vbl, None)
        pb.hook_register(0, 0x1E35, at_sync, None)
        pb.hook_register(0, 0x1D9E, at_poll, None)
        pb.hook_register(0, 0x39D8, at_rand, None)  # its FF93 read (an interrupt may come after 39D5's first instruction)
        pb.hook_register(0, 0x1DFD, at_poll, None)
        pb.hook_register(0, 0x3557, at_work, None)
        for b, a in POINTS:
            pb.hook_register(b, a, mk_point(b, a), None)
        for b, a in SFX_WRITES:
            pb.hook_register(b, a, at_sfx, None)
        for a in (0x403A, 0x403D, 0x403F):
            pb.hook_register(0x0C, a, at_store, None)
        pb.hook_register(0, 0x1F27, at_stat, None)
        pb.hook_register(0, 0x2120, at_paced, 5)
        pb.hook_register(0, 0x216E, at_paced, 1)
        pb.hook_register(0, 0x3552, at_work_end, None)
        pb.hook_register(0, 0x356B, at_work_di, None)
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
            recording[0] = True
            tick = bytearray()
            oam = bytearray()
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
                oam += bytes(m[0xFE00:0xFEA0])
                tick += bytes([m[0xCB00], m[0xFF93]])  # music tempo accumulator (per sound tick), vblank frame counter
                frames.append({"btn": b, "ff89": m[0xFF89], "ff8a": m[0xFF8A],
                               "lcd": [m[0xFF40], m[0xFF42], m[0xFF43], m[0xFF4A], m[0xFF4B], m[0xFF47], m[0xFF48], m[0xFF49]]})
                if stop_after is not None and mark_meta and len(frames) >= mark_meta[0]["frame"] + stop_after:
                    break
            for k in held:
                pb.button_release(k)
        finally:
            pb.hook_deregister(0, 0x3A6D)
            pb.hook_deregister(0, 0x3A77)
            pb.hook_deregister(0, 0x0040)
            pb.hook_deregister(0, 0x1E35)
            pb.hook_deregister(0, 0x1D9E)
            pb.hook_deregister(0, 0x39D8)
            pb.hook_deregister(0, 0x1DFD)
            pb.hook_deregister(0, 0x3557)
            for b, a in POINTS:
                pb.hook_deregister(b, a)
            for b, a in SFX_WRITES:
                pb.hook_deregister(b, a)
            for a in (0x403A, 0x403D, 0x403F):
                pb.hook_deregister(0x0C, a)
            pb.hook_deregister(0, 0x1F27)
            pb.hook_deregister(0, 0x2120)
            pb.hook_deregister(0, 0x216E)
            pb.hook_deregister(0, 0x3552)
            pb.hook_deregister(0, 0x356B)
            for mb, ma in marks:
                pb.hook_deregister(mb, ma)
            for (sb, sa), _st in switch:
                pb.hook_deregister(sb, sa)
        if save:  # the emulator state at the end, for chained scenarios
            self.e.save_state(save if "/" in save else f"ffl3/build/states/{save}.state")
        if marks:
            open(f"{out}/marks.bin", "wb").write(bytes(mark_mem))
            json.dump({"marks": mark_meta}, open(f"{out}/marks.json", "w"))
        elif os.path.exists(f"{out}/marks.json"):
            os.replace(f"{out}/marks.json", f"{out}/marks.json.old")
        open(f"{out}/start.bin", "wb").write(start["mem"])
        open(f"{out}/sram.bin", "wb").write(start["sram"] + _sram(pb))  # the cartridge RAM at the start and the end
        open(f"{out}/hram.bin", "wb").write(bytes(hram))
        open(f"{out}/tick.bin", "wb").write(bytes(tick))
        open(f"{out}/oam.bin", "wb").write(bytes(oam))
        open(f"{out}/prev.bin", "wb").write(prev)
        open(f"{out}/screens.dx.gz", "wb").write(_dx(screens, 160 * 144))
        open(f"{out}/waits.dx.gz", "wb").write(_dx(waits, 0x8000, start["mem"]))
        json.dump({"frames": wait_frames, "syncs": syncs, "polls": polls, "works": works,
                   "starts": wait_starts, "ends": wait_ends, "points": points, "sfx": sfx, "song": song, "stat": stat,
                   "rand": rand, "paced": paced}, open(f"{out}/waits.json", "w"))
        json.dump({"lean": True, "state": state, "plan": plan, "hook": f"{hb:02X}:{ha:04X}",
                   "pokes": [f"{pk[0]:04X}={pk[1]:02X}" + (f"/{pk[2]:02X}" if len(pk) > 2 else "") for pk in pokes],
                   **({"waitPokes": [[n, [f"{pk[0]:04X}={pk[1]:02X}" + (f"/{pk[2]:02X}" if len(pk) > 2 else "") for pk in pks]]
                                     for n, pks in wait_pokes]} if wait_pokes else {}),
                   "start": {k: v for k, v in start.items() if k not in ("mem", "sram")},
                   "frames": frames, **(meta or {})}, open(f"{out}/trace.json", "w"))
        return len(frames), len(wait_frames)


def _sram(pb):
    """The cartridge RAM (8 KB, bank 0), read whether or not the game has it enabled."""
    return bytes(pb.memory[0, 0xA000:0xBFFF]) + bytes([pb.memory[0, 0xBFFF]])


# addresses (bank, address) recorded as sync points ("points" in waits.json); a few only (PyBoy
# hooks patch the ROM): 00:1E49 the menu boxes (after the copies that set them up), 09:5014 the
# boxes drawn (the OAM DMA held until then, CD39), 0F:7B75 the name entry's sprite tiles (0B:7DCA)
# loaded after its record copy, 02:5278 a battle effect reading LY between paced copies, 01:7DCA
# after the name entry's 2 KiB background fill (before WY 50, which turns the frame work to the
# field), 0B:5D2B the same after a battle (after its fill and 00:20CF), 00:2F0B a script
# reference's scene event (00:1236 clears CD3D: the STAT frame work may run before) and 00:12CA its
# end (CD3D back): the events take CPU time, e.g. between two scripted walks; the wave fade's
# palette copy after its poll for line 0 (0F:7EB9; a STAT handler at every line slows the code, so
# a long sound tick misses line 0) and the copy's end (0F:7EBF, a landmark only: the replay counts
# the lines before it as the code's), its amplitude steps 0F:7E89 / 0F:7E8F and its end 0F:7E74
# (after the sound ticks); 09:40B1 the field menu about to set CD42 (its frame-tile work); 09:504F
# each menu row drawn and 09:5044 the rows shown (the hblank-paced VRAM copies) (CPU time); 0B:7E7A
# a member with status: its sprite tiles copied back with the low plane cleared (after slow copies)
# 01:5783 a map animation strip scroll's end (its pairs are written an hblank each)
# 00:026C the field loop after the field step (a step's new map row is hblank-paced: CPU time) and
# 00:0272 / 00:0275 before / after the objects are drawn (00:01A0); 01:5F2B the battle wipe's BG fill done (hblank-paced);
# 00:027B the field loop's map animation done (hblank-paced copies); 01:49CA / 49CD / 49D5 the same
# three in a jump's frame (01:49BD)
# 09:44D2 the walking figures of the save slots (09:4127) (after the slots' checks and tiles, CPU time)
# 0B:7E17 a member's figure tiles (each raw copy is hblank-paced: ~20 lines a member; the battle
# figures 0C:6001 come every few frames between script steps)
# 00:02D3 / 02E4 (map load), 00:10DC / 1152 / 1175 (battle in and out), 00:1A2B (event 1C), 0B:4008
# (battle), 0F:7F10 (lift-off): the music request FFBA written (the sound driver's tick may come
# before it in the same frame: the replay writes it at the original's time)
# 00:023B the start code's LCD on (after frames of clears with the LCD off)
# 0F:7E3B the wave set-up's handler switch (after the bracket, the fade levels and copies)
POINTS = ((0x00, 0x1E49), (0x09, 0x5014), (0x01, 0x7DCA), (0x0F, 0x7B75), (0x02, 0x5278), (0x0B, 0x5D2B), (0x00, 0x2F0B), (0x00, 0x12CA), (0x0F, 0x7EB9), (0x0F, 0x7EBF), (0x0F, 0x7E89), (0x0F, 0x7E8F), (0x0F, 0x7E74), (0x09, 0x40B1), (0x09, 0x504F), (0x09, 0x5044), (0x0B, 0x7E7A), (0x01, 0x5783), (0x00, 0x026C), (0x00, 0x0272), (0x00, 0x0275), (0x01, 0x5F2B), (0x00, 0x027B), (0x01, 0x49CA), (0x01, 0x49CD), (0x01, 0x49D5), (0x09, 0x44D2), (0x0B, 0x7E17),
          (0x00, 0x02D3), (0x00, 0x02E4), (0x00, 0x10DC), (0x00, 0x1152), (0x00, 0x1175), (0x00, 0x1A2B), (0x0B, 0x4008), (0x0F, 0x7F10), (0x00, 0x023B), (0x0F, 0x7E3B),
          (0x00, 0x01CF), (0x00, 0x1B50), (0x01, 0x5F12), (0x02, 0x4167), (0x0B, 0x675E), (0x0B, 0x678C), (0x00, 0x2FBF), (0x00, 0x037B), (0x00, 0x1DF6), (0x02, 0x43C8), (0x01, 0x7023), (0x02, 0x40A7), (0x00, 0x2FED), (0x00, 0x0200), (0x00, 0x3054), (0x01, 0x5FFB))


def plan_steps(plan):
    steps = []
    for item in plan.split(","):
        b, n = item.split(":")
        steps += [b] * int(n)
    return steps


# the game's writes of a sound effect request FFBC (`ldh [$BC],a` outside the driver, whose 0F:478B
# clears it), and the battle script's stores to FFBC (0C:4017): recorded in order as "sfx" (frame, LY); the driver's tick takes a request only from
# the original's write time on (the code before takes CPU time)
SFX_WRITES = ((0x00, 0x0853), (0x00, 0x10E6), (0x00, 0x14B4), (0x00, 0x1602), (0x00, 0x190F), (0x00, 0x1952),
              (0x00, 0x1A31), (0x00, 0x1A5C), (0x00, 0x1A86), (0x00, 0x1AEC), (0x00, 0x1BE6), (0x00, 0x1E7F),
              (0x00, 0x1E86), (0x01, 0x404B), (0x01, 0x47B9), (0x01, 0x4901), (0x01, 0x61DE), (0x01, 0x63AF),
              (0x01, 0x7047), (0x02, 0x5116), (0x02, 0x5144), (0x02, 0x516D), (0x02, 0x520A), (0x09, 0x4BBC),
              (0x09, 0x53D3), (0x0B, 0x5C07), (0x0B, 0x6D99), (0x0E, 0x7E50), (0x0F, 0x7D6C), (0x0F, 0x7DFC),
              (0x0F, 0x7F19), (0x0F, 0x7F61),
              # in code the listing shows as data (E0 BC after ld a,n; found by a ROM scan)
              (0x01, 0x40E3), (0x01, 0x41DF), (0x01, 0x4235), (0x01, 0x6127), (0x09, 0x536F), (0x09, 0x5385),
              (0x09, 0x53B4), (0x09, 0x53BB), (0x09, 0x53E5))
