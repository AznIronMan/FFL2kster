"""Legend III analysis aid: the order in which routines (labels of the recursive disassembly,
ffl3/build/analysis/rd) are entered, from a state or power-on, with frame and LY. Output local.

    [CALLTRACE_BANKS=00,09] python tools/ffl3/calltrace.py STATE|boot FRAMES [HOOK_BANK:ADDR] [PLAN]
"""
import re, sys
sys.path.insert(0, "src")
sys.path.insert(0, "tools/ffl3")
from ffl3kster.emu import Emulator
from trace_lib import plan_steps

rd = "ffl3/build/analysis/rd"
labels = []
import glob
for p in glob.glob(f"{rd}/bank_*.asm"):
    for line in open(p):
        m = re.match(r"^([FL])_([0-9A-F]{2})_([0-9A-F]{4}):", line)
        if m:
            labels.append((m.group(1), int(m.group(2), 16), int(m.group(3), 16)))
# routines entered every frame or per byte (interrupts, sound, copy/fill chains): not hooked
NOISY = {(0, a) for a in (0x0000, 0x0018, 0x0020, 0x0028, 0x1EFA, 0x1F27, 0x1F3A, 0x3E26, 0x36F1, 0x38E1, 0x38FC,
                           0x3E07, 0x3E03, 0x3DFF, 0x3DEC, 0x11A2, 0x3757, 0x3D2B, 0x108F)}
NOISY |= {(0, a) for a in range(0x1F45, 0x1FB2)}
# Hooked banks: CALLTRACE_BANKS (default 00). PyBoy's hooks patch the ROM byte, so a label the
# disassembler misplaced in data corrupts what the game reads there: with all banks hooked the
# game hangs in the field (01:54A0 entered endlessly); bank 00 alone is clean.
import os
BANKS = {int(x, 16) for x in os.environ.get("CALLTRACE_BANKS", "00").split(",") if x}
state, frames = sys.argv[1], int(sys.argv[2])
hook = tuple(int(x, 16) for x in sys.argv[3].split(":")) if len(sys.argv) > 3 and sys.argv[3] else None
steps = plan_steps(sys.argv[4]) if len(sys.argv) > 4 else ["none"] * frames
e = Emulator("ffl3/input/original.gb")
pb, m = e.pb, e.pb.memory
if state != "boot":
    e.load_state(f"ffl3/build/states/{state}.state")
out, on = sys.stdout, [hook is None]
fr = [0]
def mk(k, b, a):
    def f(_):
        if hook and (b, a) == hook:
            on[0] = True
        if on[0]:
            out.write(f"{fr[0]:4d} {m[0xFF44]:3d} {k} {b:02X}:{a:04X}\n")
    return f
for k, b, a in labels:
    if (k == "F" and b != 0x0F and (b, a) not in NOISY and (not BANKS or b in BANKS)) or (b, a) == hook:
        try:
            pb.hook_register(b, a, mk(k, b, a), None)
        except Exception as ex:
            print("no hook", b, hex(a), ex, file=sys.stderr)
if hook and (hook[0] if hook[1] >= 0x4000 else 0, hook[1]) not in {(b, a) for _, b, a in labels}:
    raise SystemExit(f"hook {hook} is not a label")
for i in range(frames):
    b = steps[i] if i < len(steps) else "none"
    for k in ("a", "b", "start", "select", "up", "down", "left", "right"):
        (pb.button_press if k in b.split("+") else pb.button_release)(k)
    pb.tick(1, False)
    if on[0]:
        fr[0] += 1
out.flush()
