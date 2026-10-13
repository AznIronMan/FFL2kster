"""Legend III analysis aid: the order in which routines (labels of the recursive disassembly,
ffl3/build/analysis/rd) are entered, from a state or power-on, with frame and LY. Output local.

    python tools/ffl3/calltrace.py STATE|boot FRAMES [HOOK_BANK:ADDR] [PLAN]
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
state, frames = sys.argv[1], int(sys.argv[2])
hook = tuple(int(x, 16) for x in sys.argv[3].split(":")) if len(sys.argv) > 3 else None
steps = plan_steps(sys.argv[4]) if len(sys.argv) > 4 else ["none"] * frames
e = Emulator("ffl3/input/original.gb")
pb, m = e.pb, e.pb.memory
if state != "boot":
    e.load_state(f"ffl3/build/states/{state}.state")
log, on = [], [hook is None]
fr = [0]
def mk(k, b, a):
    def f(_):
        if hook and (b, a) == hook:
            on[0] = True
        if on[0] and len(log) < 2_000_000:
            log.append((fr[0], m[0xFF44], k, b, a))
    return f
for k, b, a in labels:
    if k == "F" or (b, a) == hook:
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
prev = None
for f, ly, k, b, a in log:
    print(f"{f:4d} {ly:3d} {k} {b:02X}:{a:04X}")
