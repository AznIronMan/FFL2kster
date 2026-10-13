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
    # a battle started as event 8 (area 16, the first world zone); A to every prompt
    "battle1": ("town0", FIELD, [("wait", 60)] + [P("a", 40)] * 40 + [("wait", 120)]),
    # the same battle fought to the end: victory, gold, the map back
    "battle2": ("town0", FIELD, [("wait", 60)] + [P("a", 40)] * 90 + [("wait", 200)]),
}

# Battle sweep: a party of four (records poked) with the item under test in slot 0 of each
# member (uses from the item table), fighting area A (event 8): A every 40 frames. Covers the
# party-side effect handlers; the areas' monsters cover theirs.
ITEM_USES = {}


def _uses(iid):
    if not ITEM_USES:
        rom = open("ffl1/input/original.gb", "rb").read()
        for i in range(256):
            ITEM_USES[i] = rom[6 * 0x4000 + 0x3700 + i * 8 + 3]
    return ITEM_USES[iid]


def member(i, items, hp=999, cls=0xB2, flags=0x83, stats=(50, 50, 50, 50), status=0):
    rec = [status, 0x8A + i, 0xFF, 0xFF, 0xFF, cls, hp & 0xFF, hp >> 8, hp & 0xFF, hp >> 8, flags, *stats]
    its = []
    for iid in items:
        its += [iid, _uses(iid)]
    its += [0xFF] * (16 - len(its))
    return [(0xCC00 + 31 * i + k, v) for k, v in enumerate(rec + its)]


def battle_pokes(area, members):
    p = [(0xC3A9, 0x08), (0xC3AA, area), (0xC3AB, 0x01)]
    for i, m in enumerate(members):
        p += member(i, **m)
    return p


SWEEP = {
    # name: (area, [member kwargs] x 4, presses)
    "bsw01": (16, [dict(items=[0x4B, 0x2E]), dict(items=[0x4E, 0x2E]), dict(items=[0x33, 0x2E]), dict(items=[0x20])], 60),
    "bsw02": (25, [dict(items=[0x2A]), dict(items=[0x26]), dict(items=[0x34]), dict(items=[0x02, 0x2E])], 60),
    "bsw03": (39, [dict(items=[0x31]), dict(items=[0x38]), dict(items=[0x37]), dict(items=[0x39])], 60),
    "bsw04": (48, [dict(items=[0x42]), dict(items=[0x1B]), dict(items=[0x3A]), dict(items=[0x40])], 60),
    "bsw05": (59, [dict(items=[0x43]), dict(items=[0x49]), dict(items=[0x47]), dict(items=[0x4A])], 60),
    "bsw06": (44, [dict(items=[0x00, 0x2E]), dict(items=[0x7A, 0x2E]), dict(items=[0x6A]), dict(items=[0x6F])], 60),
    "bsw07": (77, [dict(items=[0x69]), dict(items=[0x72]), dict(items=[0x93]), dict(items=[0x9B])], 60),
    "bsw08": (98, [dict(items=[0xAF]), dict(items=[0xF0]), dict(items=[0x6E]), dict(items=[0xC3])], 60),
    "bsw09": (108, [dict(items=[0x83, 0x2E]), dict(items=[0xC5]), dict(items=[0xEE]), dict(items=[0xF2, 0x2E])], 60),
    "bsw10": (117, [dict(items=[0xF4, 0x2E]), dict(items=[0xF5, 0x2E]), dict(items=[0x7E]), dict(items=[0xE4])], 60),
    "bsw11": (121, [dict(items=[0xEA, 0x2E]), dict(items=[0xEB, 0x2E]), dict(items=[0x1C]), dict(items=[0xAB])], 60),
    "bsw12": (16, [dict(items=[0xD9]), dict(items=[0x2E]), dict(items=[0x2E]), dict(items=[0x2E])], 40),
}
for _n, (_area, _ms, _k) in SWEEP.items():
    PLANNED[_n] = ("town0", FIELD, [("wait", 60)] + [P("a", 40)] * _k + [("wait", 120)])

# Fixture pokes applied at the hook (address, value[, mask]), by the planner and the recorder alike.
POKES = {
    **{_n: battle_pokes(_area, _ms) for _n, (_area, _ms, _k) in SWEEP.items()},
    "care1": [(0xCC0F, 0x84), (0xCC10, 0x05), (0xCC06, 0x0A), (0xCC07, 0x00)],
    "battle1": [(0xC3A9, 0x08), (0xC3AA, 0x10), (0xC3AB, 0x01)],
    "battle2": [(0xC3A9, 0x08), (0xC3AA, 0x10), (0xC3AB, 0x01)],
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
