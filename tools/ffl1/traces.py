"""Legend I parity scenarios: record the PyBoy ground-truth traces the port's parity tests replay
(port/packages/ffl1-parity). Output in ffl1/build/traces/NAME (ROM-derived, gitignored).

    python tools/ffl1/traces.py            # all scenarios
    python tools/ffl1/traces.py newgame1   # some
"""
import sys
sys.path.insert(0, "tools/ffl1")
sys.path.insert(0, "src")
from trace_lib import Recorder, plan_steps  # noqa: E402

TITLE = (3, 0x7D50)   # 03:7D50, the title (reached from power-on)

# name: (state, hook, plan)
SCENARIOS = {
    "title1": ("boot", TITLE, "none:400"),
    "probe1": ("boot", TITLE, "none:60,a:3,none:20,a:1500,none:200"),
    "newgame1": ("boot", TITLE, "none:60,a:3,none:20,a:330,none:100,down:2,none:10,a:2,none:60,a:2,none:8,right:2,"
                                "none:8,a:2,none:8,right:2,none:8,a:2,none:8,start:2,none:600"),
}


def main(names):
    r = Recorder()
    for n in names or SCENARIOS:
        state, hook, plan = SCENARIOS[n]
        print(n, r.record(n, state, plan_steps(plan), hook=hook, plan=plan))


if __name__ == "__main__":
    main(sys.argv[1:])
