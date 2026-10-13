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
    # power-on from the start code 00:0224 (the port's cold start), the title, a new game begun
    "power1": ("boot", (0, 0x0224), "none:300,a:3,none:20,a:300,none:100"),
    "probe1": ("boot", TITLE, "none:60,a:3,none:20,a:1500,none:200"),
    "newgame1": ("boot", TITLE, "none:60,a:3,none:20,a:330,none:100,down:2,none:10,a:2,none:60,a:2,none:8,right:2,"
                                "none:8,a:2,none:8,right:2,none:8,a:2,none:8,start:2,none:600", "town0"),
    "walk1": ("town0", FIELD, "up:40,none:10,right:20,none:10,a:2,none:120,a:2,none:60,a:2,none:60,down:30,left:40,none:30"),
    "walk2": ("town0", FIELD, "right:100,up:16,a:2,none:90,a:2,none:90,a:2,none:60,up:48,a:2,none:90,a:2,none:90,a:2,none:60,"
                              "right:64,up:30,a:2,none:90,a:2,none:90,a:2,none:60,left:40,up:40,a:2,none:90,a:2,none:90,a:2,none:90"),
}

# Sound checks: from the first town's field loop (idle: no busy frames, so the frame tick and a
# request written at the hook line up as in the port), a sound effect (FFE4 = 1-36, tables
# 07:6BC7 / 07:6C0F) or a jingle (FFE2 = song: the music saved to CE60 and restored when the
# jingle's channels have all ended) poked at the hook, then no input.
SFX_COUNT = 36
for _i in range(1, SFX_COUNT + 1):
    SCENARIOS[f"sfx{_i:02d}"] = ("town0", FIELD, "none:150")
JINGLES = (0x0B, 0x0C, 0x0D, 0x0F, 0x10, 0x11)
for _j in JINGLES:
    SCENARIOS[f"jng{_j:02x}"] = ("town0", FIELD, "none:900")

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
    # round 2: tougher areas (the boss formations 0-5), so every member acts many times
    "bsw13": (2, [dict(items=[0x4E], stats=(99, 99, 99, 99)), dict(items=[0x33], stats=(99, 99, 99, 99)),
                  dict(items=[0x37], stats=(99, 99, 99, 99)), dict(items=[0x39], stats=(99, 99, 99, 99))], 60),
    "bsw14": (3, [dict(items=[0x43], stats=(99, 99, 99, 99)), dict(items=[0x49], stats=(99, 99, 99, 99)),
                  dict(items=[0x47], stats=(99, 99, 99, 99)), dict(items=[0x9B], stats=(99, 99, 99, 99))], 60),
    "bsw15": (4, [dict(items=[0xEA], stats=(99, 99, 99, 99)), dict(items=[0xEB], stats=(99, 99, 99, 99)),
                  dict(items=[0x79], stats=(99, 99, 99, 99)), dict(items=[0x44], stats=(99, 99, 99, 99))], 60),
    "bsw16": (16, [dict(items=[0xD9]), dict(items=[]), dict(items=[0x2E]), dict(items=[0x2E])], 40),
    "bsw17": (1, [dict(items=[0x37], stats=(99, 99, 99, 99)), dict(items=[0x39], stats=(99, 99, 99, 99)),
                  dict(items=[0x02], stats=(99, 99, 99, 99)), dict(items=[0x00], stats=(99, 99, 99, 99))], 60),
    "bsw18": (0, [dict(items=[0x37], stats=(99, 99, 99, 99)), dict(items=[0x45], stats=(99, 99, 99, 99)),
                  dict(items=[0x6E], stats=(99, 99, 99, 99)), dict(items=[0x48], stats=(99, 99, 99, 99))], 60),
    "bsw19": (5, [dict(items=[0x46], stats=(99, 99, 99, 99)), dict(items=[0x3F], stats=(99, 99, 99, 99)),
                  dict(items=[0x3C], stats=(99, 99, 99, 99)), dict(items=[0x41], stats=(99, 99, 99, 99))], 60),
    # victory with meat and growth: a monster member (record +0A bit 6) and a mutant
    "bsw20": (17, [dict(items=[0x2E], cls=0x08, flags=0x43), dict(items=[0x2E], flags=0x23),
                   dict(items=[0x37]), dict(items=[0x37])], 70),
    # round 3: the CREATOR (area 1, picture type 2: the boss death 07:75C6) to the SAW; EXPLODE
    # used by member 0, the fastest, before the weak weapons behind it (in bsw12/bsw16 the battle
    # ended before the EXPLODE turn came)
    "bsw21": (1, [dict(items=[0x42], stats=(99, 99, 99, 99)), dict(items=[0x42], stats=(99, 99, 99, 99)),
                  dict(items=[0x42], stats=(99, 99, 99, 99)), dict(items=[0x42], stats=(99, 99, 99, 99))], 80),
    "bsw22": (16, [dict(items=[0xD9], stats=(50, 50, 99, 50)), dict(items=[0x37], stats=(1, 1, 1, 1)),
                   dict(items=[0x37], stats=(1, 1, 1, 1)), dict(items=[0x37], stats=(1, 1, 1, 1))], 50),
    # the monster abilities with the remaining screen effects: ACID (07:7895), TORNADO (07:78F9;
    # in bsw23 the ACID ended the battle first)
    "bsw23": (16, [dict(items=[0xC1], stats=(50, 50, 99, 50)), dict(items=[0xC0], stats=(50, 50, 98, 50)),
                   dict(items=[0x37], stats=(1, 1, 1, 1)), dict(items=[0x37], stats=(1, 1, 1, 1))], 50),
    "bsw24": (16, [dict(items=[0xC0], stats=(50, 50, 99, 50)), dict(items=[0x37], stats=(1, 1, 1, 1)),
                   dict(items=[0x37], stats=(1, 1, 1, 1)), dict(items=[0x37], stats=(1, 1, 1, 1))], 50),
}
for _n, (_area, _ms, _k) in SWEEP.items():
    PLANNED[_n] = ("town0", FIELD, [("wait", 60)] + [P("a", 40)] * _k + [("wait", 120)])

# flee: Run at the fight/run prompt until it succeeds (00:4xxx escape roll), then the map back
PLANNED["flee1"] = ("town0", FIELD, [("wait", 240)] + [P("down"), P("a", 90)] * 8 + [("wait", 200)])

# defeat: a party at 1 HP against area 16 (in area 2 the bosses never hit); game over, a button, the restart
# (06:6298 jp 00:0101 -> 00:0224) and the title
PLANNED["defeat1"] = ("town0", FIELD, [("wait", 60)] + [P("a", 40)] * 70 + [("wait", 300)])

# Field sweep (P2): every map, entered through the first warp (bank 02:52D0, 3 bytes: map, x, y)
# that leads to it — the warp event poked at the field loop (C3A9 = 05 for warps 0-FF, 06 for
# 100+; C3AA = the warp's low byte; C5BA = 0: a map just loaded ignores warps until the first step)
# from the first town — then a walk: 3 steps each way, A, twice.
WARP_TABLE, WARP_COUNT = 2 * 0x4000 + 0x12D0, 474


def _field_sweep():
    rom = open("ffl1/input/original.gb", "rb").read()
    first = {}
    for n in range(WARP_COUNT):
        first.setdefault(rom[WARP_TABLE + 3 * n], n)
    return {f"fsw{mp:03d}": n for mp, n in sorted(first.items())}


FIELD_SWEEP = _field_sweep()
_WALK = ([("press", "up", 16, 4)] * 3 + [("press", "right", 16, 4)] * 3 + [("press", "down", 16, 4)] * 3
         + [("press", "left", 16, 4)] * 3 + [P("a", 60)]) * 2
for _n in FIELD_SWEEP:
    PLANNED[_n] = ("town0", FIELD, [("wait", 90)] + _WALK + [("wait", 120)])

# Fixture pokes applied at the hook (address, value[, mask]), by the planner and the recorder alike.
POKES = {
    **{_n: battle_pokes(_area, _ms) for _n, (_area, _ms, _k) in SWEEP.items()},
    **{_n: [(0xC5BA, 0x00), (0xC3A9, 0x06 if _w >= 0x100 else 0x05), (0xC3AA, _w & 0xFF), (0xC3AB, 0x01)]
       for _n, _w in FIELD_SWEEP.items()},
    **{f"sfx{_i:02d}": [(0xFFE4, _i)] for _i in range(1, SFX_COUNT + 1)},
    **{f"jng{_j:02x}": [(0xFFE2, _j)] for _j in JINGLES},
    "care1": [(0xCC0F, 0x84), (0xCC10, 0x05), (0xCC06, 0x0A), (0xCC07, 0x00)],
    "battle1": [(0xC3A9, 0x08), (0xC3AA, 0x10), (0xC3AB, 0x01)],
    "flee1": battle_pokes(16, [dict(items=[0x37])] * 4),
    "defeat1": battle_pokes(16, [dict(items=[0x00], hp=1, stats=(1, 1, 1, 1))] * 4),
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
