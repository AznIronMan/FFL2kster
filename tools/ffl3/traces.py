"""Legend III parity scenarios: record the PyBoy ground-truth traces the port's parity tests replay
(port/packages/ffl3-parity). Output in ffl3/build/traces/NAME (ROM-derived, gitignored).

    python tools/ffl3/traces.py            # all scenarios
    python tools/ffl3/traces.py title1     # some
"""
import sys
sys.path.insert(0, "tools/ffl3")
sys.path.insert(0, "src")
from trace_lib import Recorder, plan_steps  # noqa: E402

TITLE = (1, 0x7C79)   # 01:7C79, the title (called by the start code 00:0200 at 00:023C)
START = (0, 0x0200)   # 00:0200, the start code (power-on: 00:0100 jp 0200)

# name: (state, hook, plan[, state saved at the end])
SCENARIOS = {
    "title1": ("boot", TITLE, "none:400"),
    # the title menu: cursor down/up, B and Start (buzzer), Select, a direction held (key repeat)
    "title2": ("boot", TITLE, "none:60,down:3,none:30,up:3,none:30,b:3,none:40,start:3,none:40,select:3,none:20,"
                              "down:45,none:30,left:3,none:30"),
}


def main(names):
    rec = Recorder()
    try:
        for name in names or list(SCENARIOS):
            state, hook, plan, *save = SCENARIOS[name]
            n, w = rec.record(name, state, plan_steps(plan), hook=hook, plan=plan, save=save[0] if save else None)
            print(f"{name}: {n} frames, {w} waits")
    finally:
        rec.close()


if __name__ == "__main__":
    main(sys.argv[1:])
