"""Ground truth for the bank-0E sound driver port: run PyBoy and record, for every call of the driver
(0E:4006, entered from the frame tick 00:16F9 via 0E:4000) and for the boot init (0E:4003 called at
00:0283), the driver RAM before and after the call and the ordered APU register writes made during it.
Writes are caught with PyBoy hooks on every `ldh [$10-$3F],a` and `ld [c],a` instruction of the driver
(found by a recursive disassembly from 0E:4006/4048 and the three command jump tables), reading A/C
before the instruction executes. Optionally the PyBoy audio of every frame is saved too.

Output (gitignored, ROM-derived): build/sound/fixtures/<scenario>.bin.gz with records
  u8 kind (0 = tick 0E:4000, 1 = init 0E:4003), u32 frame, u16 nwrites,
  in[273] = CB00-CBFF, FFB0-FFBF, FF25 before the call; out[272] = CB00-CBFF, FFB0-FFBF after,
  writes: nwrites x (u8 reg - 0xFF00, u8 value)
and build/sound/audio/<scenario>.npy (int8 stereo, PyBoy's 48 kHz buffer) when audio is captured.

usage: ~/venv/bin/python tools/sound_capture.py [scenario ...]   (default: all; see SCENARIOS)"""
import gzip, os, struct, sys
import numpy as np
sys.path.insert(0, "tools")
sys.path.insert(0, "src")
from sm83dis import decode  # noqa: E402

ROM = "input/original.gb"
OUT = "build/sound/fixtures"
AUD = "build/sound/audio"
STATE = "build/states_snd/first_town.state"
rom = open(ROM, "rb").read()


def off(bank, pc):
    return pc if pc < 0x4000 else bank * 0x4000 + pc - 0x4000


def driver_code():
    """(addr -> text) for the driver code in bank 0E, by recursive descent."""
    ents = [0x4006, 0x4048, 0x409B]
    for tab in (0x4358, 0x45AB, 0x4706):
        for i in range(12):
            o = off(0x0E, tab + 2 * i)
            ents.append(rom[o] | rom[o + 1] << 8)
    code, todo = {}, list(ents)
    while todo:
        pc = todo.pop()
        while 0x4000 <= pc < 0x8000 and pc not in code:
            ln, t, tg = decode(rom, 0x0E, pc)
            code[pc] = t
            op = t.split()[0]
            if tg is not None and 0x4000 <= tg < 0x8000:
                todo.append(tg)
            if t in ("ret", "reti", "jp hl") or (op in ("jp", "jr") and "," not in t):
                break
            pc += ln
    return code


def apu_writers(code):
    hs = []
    for pc, t in code.items():
        if t.startswith("ldh [$") and t.endswith("],a"):
            r = int(t[6:8], 16)
            if 0x10 <= r < 0x40:
                hs.append((pc, r))
        elif t == "ld [c],a":
            hs.append((pc, None))
    return sorted(hs)


class Rec:
    def __init__(self, pb):
        self.pb = pb
        self.cur = None
        self.recs = []
        self.frame = 0

    def state_in(self):
        m = self.pb.memory
        return bytes(m[0xCB00:0xCC00]) + bytes(m[0xFFB0:0xFFC0]) + bytes([m[0xFF25]])

    def begin(self, kind):
        if self.cur is not None:
            raise RuntimeError("nested driver call")
        self.cur = (kind, self.frame, self.state_in(), [])

    def end(self):
        if self.cur is None:
            return
        kind, fr, sin, w = self.cur
        m = self.pb.memory
        sout = bytes(m[0xCB00:0xCC00]) + bytes(m[0xFFB0:0xFFC0])
        self.recs.append((kind, fr, sin, sout, w))
        self.cur = None

    def write(self, reg):
        if self.cur is None:
            return
        rf = self.pb.register_file
        r = reg if reg is not None else rf.C
        self.cur[3].append((r, rf.A))

    def dump(self, path):
        with gzip.open(path, "wb") as f:
            for kind, fr, sin, sout, w in self.recs:
                f.write(struct.pack("<BIH", kind, fr, len(w)))
                f.write(sin)
                f.write(sout)
                f.write(bytes(b for rv in w for b in rv))


def make(state=STATE, sound=True):
    from ffl2kster.emu import Emulator
    e = Emulator(ROM, sound=sound)
    if state:
        e.load_state(state)
    pb = e.pb
    rec = Rec(pb)
    pb.hook_register(0x0E, 0x4006, lambda _: rec.begin(0), None)
    pb.hook_register(0x0E, 0x4047, lambda _: rec.end(), None)
    for pc, r in apu_writers(driver_code()):
        pb.hook_register(0x0E, pc, (lambda r: lambda _: rec.write(r))(r), None)
    return e, pb, rec


def run(pb, rec, n, audio=None, hook=None):
    for i in range(n):
        if hook:
            hook(i)
        pb.tick(1, False, sound=audio is not None)
        rec.frame += 1
        if audio is not None:
            audio.append(pb.sound.ndarray.copy())


def finish(name, e, rec, audio=None):
    os.makedirs(OUT, exist_ok=True)
    rec.dump(f"{OUT}/{name}.bin.gz")
    if audio:
        os.makedirs(AUD, exist_ok=True)
        np.save(f"{AUD}/{name}.npy", np.concatenate(audio).astype(np.int8))
    print(f"{name}: {len(rec.recs)} calls, {sum(len(r[4]) for r in rec.recs)} writes", flush=True)
    e.close()


SONG_FRAMES = {1: 2300, 2: 3500, 3: 2200, 4: 2200, 5: 3500, 6: 2200, 7: 2200, 8: 2400, 9: 2200, 10: 4300,
               11: 2700, 12: 2200, 13: 3700, 14: 2200, 15: 4400, 16: 4100, 17: 2700, 18: 2300, 19: 3900}


def song(n):
    """Power the APU off (so PyBoy's audio starts from the same clean APU state as a fresh
    synthesizer), stop the town music (FFB0 = 0: the driver re-inits and powers the APU on),
    30 frames later request song n."""
    e, pb, rec = make()
    audio = []
    pb.memory[0xFF26] = 0
    pb.memory[0xFFB0] = 0
    run(pb, rec, 30, audio)
    pb.memory[0xFFB0] = n
    run(pb, rec, SONG_FRAMES[n], audio)
    finish(f"song_{n:02d}", e, rec, audio)


def sfx_all():
    """Every SFX id 1-57 over the town music, 150 frames apart (each interrupts pulse 1)."""
    e, pb, rec = make()
    def h(i):
        if i % 150 == 10 and i // 150 < 57:
            pb.memory[0xFFB2] = i // 150 + 1
    run(pb, rec, 57 * 150 + 60, None, h)
    finish("sfx_all", e, rec)


def sfx_audio():
    """Every SFX id 1-57 alone (APU powered off first, music stopped), 120 frames apart, with
    PyBoy's audio: the synthesizer comparison for the noise channel and the pulse-1 sweep."""
    e, pb, rec = make()
    audio = []
    pb.memory[0xFF26] = 0
    pb.memory[0xFFB0] = 0
    def h(i):
        if i % 120 == 30 and i // 120 < 57:
            pb.memory[0xFFB2] = i // 120 + 1
    run(pb, rec, 57 * 120 + 30, audio, h)
    finish("sfx_audio", e, rec, audio)


def sfx_overlap():
    """SFX started while another SFX runs, and a song request made during an SFX (deferred)."""
    e, pb, rec = make()
    plan = {10: (0xFFB2, 1), 14: (0xFFB2, 10), 40: (0xFFB2, 25), 42: (0xFFB0, 12), 200: (0xFFB2, 5),
            203: (0xFFB2, 33), 400: (0xFFB2, 57), 402: (0xFFB2, 44)}
    def h(i):
        if i in plan:
            a, v = plan[i]
            pb.memory[a] = v
    run(pb, rec, 900, None, h)
    finish("sfx_overlap", e, rec)


def song_change():
    """Song changes mid-song, a stop (FFB0 = 0) and a restart."""
    e, pb, rec = make()
    plan = {0: 12, 500: 17, 1100: 5, 1400: 0, 1600: 9, 2100: 19, 2350: 12}
    def h(i):
        if i in plan:
            pb.memory[0xFFB0] = plan[i]
    run(pb, rec, 2800, None, h)
    finish("song_change", e, rec)


def jingle():
    """FFB1: save the playing song, play song 1 (non-looping) and restore when it ends; then FFB1
    over song 12 with SFX during the jingle, cancelled early by clearing FFB1 (restore at once)."""
    e, pb, rec = make()
    plan = {0: (0xFFB0, 12), 300: (0xFFB1, 1), 2700: (0xFFB2, 3), 2800: (0xFFB1, 1), 2900: (0xFFB2, 7),
            3100: (0xFFB2, 20), 3300: (0xFFB1, 0)}
    def h(i):
        if i in plan:
            a, v = plan[i]
            pb.memory[a] = v
    run(pb, rec, 5400, None, h)
    finish("jingle", e, rec)


def boot():
    """Power-on: the init call 0E:4003 (from 00:0283) and the first frames."""
    e, pb, rec = make(state=None, sound=True)
    pb.hook_register(0x00, 0x0283, lambda _: rec.begin(1), None)
    pb.hook_register(0x00, 0x0286, lambda _: rec.end(), None)
    run(pb, rec, 300)
    finish("boot", e, rec)


SCENARIOS = {f"song_{n:02d}": (lambda n: lambda: song(n))(n) for n in range(1, 20)}
SCENARIOS.update(sfx_all=sfx_all, sfx_audio=sfx_audio, sfx_overlap=sfx_overlap, song_change=song_change, jingle=jingle, boot=boot)

if __name__ == "__main__":
    names = sys.argv[1:] or list(SCENARIOS)
    for nm in names:
        SCENARIOS[nm]()
