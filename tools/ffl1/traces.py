"""Legend I parity scenarios: record the PyBoy ground-truth traces the port's parity tests replay
(port/packages/ffl1-parity). Output in ffl1/build/traces/NAME (ROM-derived, gitignored).

    python tools/ffl1/traces.py            # all scenarios
    python tools/ffl1/traces.py newgame1   # some
"""
import sys
sys.path.insert(0, "tools/ffl1")
sys.path.insert(0, "src")
from trace_lib import Recorder, plan_steps  # noqa: E402
from planner import Planner  # noqa: E402

TITLE = (3, 0x7D50)   # 03:7D50, the title (reached from power-on)
FIELD = (0, 0x1243)   # 00:1243, the top of the field loop

# name: (state, hook, plan[, state saved at the end]); scenarios that start from a saved state
# come after the one that saves it.
SCENARIOS = {
    "title1": ("boot", TITLE, "none:400"),
    "probe1": ("boot", TITLE, "none:60,a:3,none:20,a:1500,none:200"),
    "newgame1": ("boot", TITLE, "none:60,a:3,none:20,a:330,none:100,down:2,none:10,a:2,none:60,a:2,none:8,right:2,"
                                "none:8,a:2,none:8,right:2,none:8,a:2,none:8,start:2,none:600", "town0"),
    "walk1": ("town0", FIELD, "up:40,none:10,right:20,none:10,a:2,none:120,a:2,none:60,a:2,none:60,down:30,left:40,none:30"),
    "walk2": ("town0", FIELD, "right:100,up:16,a:2,none:90,a:2,none:90,a:2,none:60,up:48,a:2,none:90,a:2,none:90,a:2,none:60,"
                              "right:64,up:30,a:2,none:90,a:2,none:90,a:2,none:60,left:40,up:40,a:2,none:90,a:2,none:90,a:2,none:90"),
}

# Planned scenarios: (state, hook, actions[, state saved at the end]) -> the plan comes from
# tools/ffl1/planner.py run on the same state (deterministic).
P = lambda b, w=24: ("press", b, 5, w)
PLANNED = {
    "talk1": ("town0", FIELD, [("goto", 24, 20), ("face", "up"), ("press", "a", 4, 150), ("press", "a", 4, 90),
                               ("press", "a", 4, 90), ("press", "a", 4, 90), ("wait", 30)]),
    # main menu: abilities (member 0, an item, back), bag (back), equipment (back), save (no), close
    "menu1": ("town0", FIELD, [P("start", 60), P("a"), P("a", 40), P("a"), P("b"), P("b"), P("b"), P("right"), P("a", 40),
                               P("b"), P("right"), P("a"), P("a", 40), P("b"), P("b"), P("down"), P("a"), P("right"),
                               P("a", 30), P("b", 60), ("wait", 30)]),
    # party order: open, move the cursor, change the text speed, close
    "order1": ("town0", FIELD, [P("select", 60), P("down"), P("down"), P("right"), P("a"), P("b", 60), ("wait", 30)]),
    # inn: walk up into the counter (bump event), yes, wait, close
    "inn1": ("town0", FIELD, [("goto", 18, 25), ("press", "up", 6, 60), P("a", 60), P("a", 60), P("a", 60), ("wait", 30)]),
    # shop: buy the first item, sell it back, leave
    "shop1": ("town0", FIELD, [("goto", 29, 18), ("press", "up", 6, 60), P("a", 40), P("a", 40), P("a", 60), P("a", 40),
                               P("b", 40), P("down"), P("a", 40), P("a", 40), P("a", 40), P("a", 60), P("b", 40),
                               P("b", 40), P("b", 60), ("wait", 30)]),
    # guild: recruit member 1 (class list of this guild), back out
    "guild1": ("town0", FIELD, [("goto", 21, 25), ("press", "up", 6, 60), P("down"), P("a", 40), P("a", 60),
                                P("a", 60), P("a"), P("a"), P("start", 60), P("b", 40), P("b", 60), ("wait", 30)]),
    # field use of the ability CARE (00:39AA): member 0 given CARE (5 uses) and 10 HP; abilities,
    # member 0, CARE, back out. 39AA never loads h (0x39 from the jp hl): it reads ROM page 0x39 and
    # its writes are MBC2 bank selects, so the HP stays 10.
    "care1": ("town0", FIELD, [P("start", 60), P("a"), P("a", 40), P("a", 60), P("a", 60), P("b"), P("b"), P("b"),
                               P("b", 60), ("wait", 30)]),
}

# Fixture pokes applied at the hook (address, value[, mask]), by the planner and the recorder alike.
POKES = {
    "care1": [(0xCC0F, 0x84), (0xCC10, 0x05), (0xCC06, 0x0A), (0xCC07, 0x00)],
}


def plan_for(name):
    if name in SCENARIOS:
        return SCENARIOS[name]
    state, hook, actions, *save = PLANNED[name]
    p = Planner(state, hook, pokes=POKES.get(name, ()))
    p.run(actions)
    plan = p.plan()
    p.e.__exit__(None, None, None)
    return (state, hook, plan, *save)


def main(names):
    r = Recorder()
    for n in names or [*SCENARIOS, *PLANNED]:
        state, hook, plan, *save = plan_for(n)
        print(n, r.record(n, state, plan_steps(plan), hook=hook, plan=plan, pokes=POKES.get(n, ()),
                          save=save[0] if save else None))


if __name__ == "__main__":
    main(sys.argv[1:])
