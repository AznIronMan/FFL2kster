"""Record a frame-by-frame ground-truth trace from PyBoy for engine parity tests.

The recording starts at a canonical code point so the engine can resume from the same place:
after loading STATE, the emulator runs until the CPU reaches HOOK (default 00:1A43, the top of
the field main loop) and the machine (8000-FFFF + registers) is saved there as start.bin.
Then each frame of the button PLAN is ticked and recorded.

Output build/traces/<name>/: start.bin, trace.json (per frame: buttons, FF89/FF8A, LCD
registers, key WRAM bytes), screens.bin (160x144 shade bytes per frame), wram.bin (C000-DFFF
per frame), vram.bin (8000-9FFF per frame), oam.bin (FE00-FE9F per frame), hram.bin (FF80-FFFF),
and waits.bin: the machine (8000-FFFF) at every frame wait (where rst $10 ends its halt loop at vblank, 00:00E4,
after the OAM page flip), the engine's `yield` points, with waits.json listing the frame of each.
With --mark BB:AAAA[,BB:AAAA...] the machine is also saved each time the CPU reaches one of those
addresses after the start (e.g. the return address of a hooked routine): marks.bin + marks.json
(frame, number of waits recorded before it, address, registers of each).
With --poke AAAA=VV[,AAAA=VV...] those bytes are written when the hook is reached, before the
start snapshot (to set up a situation, e.g. battle inventories).
Usage: python tools/trace_record.py NAME STATE "btn:frames,..." [total] [--hook BB:AAAA] [--mark BB:AAAA,...] [--poke AAAA=VV,...]
  btn in up/down/left/right/a/b/start/select/none (several joined by '+'); each item holds the
  buttons for N frames."""
import json, os, sys
import numpy as np
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator

SH = {255: 0, 153: 1, 85: 2, 0: 3}
KEYS = [0xC42C, 0xC42D, 0xC42E, 0xC42F, 0xC434, 0xC435, 0xC436, 0xC437, 0xC438, 0xC43C, 0xC43D, 0xC43E,
        0xC442, 0xC443, 0xFFC1, 0xFFC2, 0xC4FF, 0xC7DF]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    hook = "00:1A43"
    if "--hook" in sys.argv:
        hook = sys.argv[sys.argv.index("--hook") + 1]
        args.remove(hook)
    marks_at = []
    if "--mark" in sys.argv:
        mk = sys.argv[sys.argv.index("--mark") + 1]
        args.remove(mk)
        marks_at = [tuple(int(x, 16) for x in t.split(":")) for t in mk.split(",")]
    pokes = []
    if "--poke" in sys.argv:
        pk = sys.argv[sys.argv.index("--poke") + 1]
        args.remove(pk)
        pokes = [tuple(int(x, 16) for x in t.split("=")) for t in pk.split(",")]
    name, state, plan = args[0], args[1], args[2]
    total = int(args[3]) if len(args) > 3 else None
    steps = []
    for item in plan.split(","):
        b, n = item.split(":")
        steps += [b] * int(n)
    if total:
        steps += ["none"] * max(0, total - len(steps))
    out = f"build/traces/{name}"
    os.makedirs(out, exist_ok=True)
    frames, screens, wram, vram, oam, hram = [], bytearray(), bytearray(), bytearray(), bytearray(), bytearray()
    with Emulator("input/original.gb") as e:
        pb = e.pb
        if state != "boot":  # "boot": from power-on
            st = state if "/" in state else f"build/states/{state}.state"
            e.load_state(st)
        hb, ha = (int(x, 16) for x in hook.split(":"))
        start = {}
        frames_ref = frames
        waits, wait_frames = bytearray(), []
        armed = [False]

        def cb(_):
            if start:
                return
            for pa, pv in pokes:
                pb.memory[pa] = pv
            r = pb.register_file
            start["regs"] = {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL, "sp": r.SP, "pc": r.PC}
            start["mem"] = bytes(pb.memory[0x8000:0x10000])
            start["frame"] = pb.frame_count
            start["ly"] = pb.memory[0xFF44]

        # Frame waits are recorded from the start snapshot on, including those in the same tick.
        def arm(_):
            if start:
                armed[0] = True

        def at_halt(_):
            if armed[0]:
                armed[0] = False
                waits.extend(bytes(pb.memory[0x8000:0x10000]))
                wait_frames.append(len(frames_ref))
        pb.hook_register(hb, ha, cb, None)
        pb.hook_register(0, 0x00D9, arm, None)
        pb.hook_register(0, 0x00E4, at_halt, None)  # rst $10 returns: LY reached 0x90 (vblank)
        for _ in range(3000):
            # rendered: PyBoy keeps the window line counter only in rendered frames, so the first
            # recorded frame would show the window shifted after unrendered ones
            pb.tick(1, True)
            if start:
                break
        pb.hook_deregister(hb, ha)
        marks, mark_meta = bytearray(), []

        def mk_mark(bank, addr):
            def at_mark(_):
                r = pb.register_file
                marks.extend(bytes(pb.memory[0x8000:0x10000]))
                mark_meta.append({"frame": len(frames_ref), "waits": len(wait_frames), "at": f"{bank:02X}:{addr:04X}",
                                  "regs": {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL}})
            return at_mark
        for mb, ma in marks_at:
            pb.hook_register(mb, ma, mk_mark(mb, ma), None)
        if not start:
            raise SystemExit(f"hook {hook} not reached")
        open(f"{out}/start.bin", "wb").write(start["mem"])
        held = set()
        for b in steps:
            want = set() if b == "none" else set(b.split("+"))
            for k in held - want:
                pb.button_release(k)
            for k in want - held:
                pb.button_press(k)
            held = want
            pb.tick(1, True)
            m = pb.memory
            shot = np.array(pb.screen.image.convert("RGB"))[:, :, 0].reshape(-1)
            screens += bytes(SH.get(int(x), 0) for x in shot)
            wram += bytes(m[0xC000:0xE000])
            vram += bytes(m[0x8000:0xA000])
            oam += bytes(m[0xFE00:0xFEA0])
            hram += bytes(m[0xFF80:0x10000])
            frames.append({"btn": b, "ff89": m[0xFF89], "ff8a": m[0xFF8A],
                           "lcd": [m[0xFF40], m[0xFF42], m[0xFF43], m[0xFF4A], m[0xFF4B], m[0xFF47], m[0xFF48], m[0xFF49]],
                           "keys": {f"{k:04X}": m[k] for k in KEYS}})
        for k in held:
            pb.button_release(k)
    open(f"{out}/waits.bin", "wb").write(bytes(waits))
    json.dump({"frames": wait_frames}, open(f"{out}/waits.json", "w"))
    if marks_at:
        open(f"{out}/marks.bin", "wb").write(bytes(marks))
        json.dump({"marks": mark_meta}, open(f"{out}/marks.json", "w"))
    json.dump({"state": state, "plan": plan, "hook": hook, "pokes": [f"{a:04X}={v:02X}" for a, v in pokes], "start": {k: v for k, v in start.items() if k != "mem"},
               "frames": frames}, open(f"{out}/trace.json", "w"))
    for fn, data in (("screens", screens), ("wram", wram), ("vram", vram), ("oam", oam), ("hram", hram)):
        open(f"{out}/{fn}.bin", "wb").write(bytes(data))
    print(name, len(frames), "frames; start", start["regs"], "LY", start["ly"])


if __name__ == "__main__":
    main()
