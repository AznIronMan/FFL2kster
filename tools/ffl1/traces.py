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
    # the title's cursor (Left / Right, 03:7E11), Select, then B eleven times, the last with
    # Down + Start held: the sound test (03:7E4A): entries, the cursor, A plays
    "title2": ("boot", TITLE, "none:60,left:2,none:10,right:2,none:10,select:2,none:10," + "b:2,none:8," * 10
               + "down+start:6,down+start+b:3,down+start:6,none:60,up:2,none:10,up:2,none:10,a:2,none:120,"
               "right:2,none:10,up:2,none:10,up:2,none:10,a:2,none:120,left:2,none:10,down:2,none:10,down:2,"
               "none:10,a:2,none:200"),
    # name entry: a letter, B deletes it, B with the name empty goes back to the class select
    # (03:7BA6), then the new game as newgame1
    "newgame2": ("boot", TITLE, "none:60,a:3,none:20,a:330,none:100,down:2,none:10,a:2,none:60,a:2,none:8,right:2,"
                                "none:8,a:2,none:8,b:2,none:8,b:2,none:8,b:2,none:60,a:2,none:60,a:2,none:8,right:2,"
                                "none:8,a:2,none:8,right:2,none:8,a:2,none:8,start:2,none:600"),
    # save (main menu 3, 00:26FE), soft reset (A+B+Select+Start, 00:06DB), the title's CONTINUE
    # (the save valid: the cursor on it), continue (00:1224: the saved map), a walk
    "reset1": ("town0", FIELD, "none:30,start:3,none:40,down:3,none:15,down:3,none:15,down:3,none:15,a:3,none:60,"
                               "a:3,none:200,b:3,none:40,b:3,none:60,a+b+select+start:10,none:400,a:3,none:600,"
                               "up:30,none:10,right:20,none:60"),
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

# A monster that flees (06:5A37 -> FC -> 06:5098): area 22's REDBULL has one usable ability (HORN,
# 10 uses; {44}ICE is passive); one member (the others down) who only defends ({E9}KING) outlasts
# it. A plain plan (A every 40 frames): the planner's per-frame edge check is slow for long runs.
SCENARIOS["flee2"] = ("town0", FIELD, "none:60," + ",".join(["a:5,none:35"] * 300) + ",none:300")

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
    # round 4: the handlers not yet reached, the item in slot 0 of the fastest member, the others
    # with potions so the battle lasts: 44B0 (handler 0: ELIXIR, a field item), 451B (handler 4:
    # the {E9} items 4E and 13), 5098 (handler 47: item FC, which no monster holds)
    "bsw25": (16, [dict(items=[0x08], stats=(50, 50, 99, 50))] + [dict(items=[0x00], stats=(1, 1, 1, 1))] * 3, 40),
    "bsw26": (16, [dict(items=[0x4E], stats=(50, 50, 99, 50))] + [dict(items=[0x00], stats=(1, 1, 1, 1))] * 3, 40),
    "bsw27": (16, [dict(items=[0xFC], stats=(50, 50, 99, 50))] + [dict(items=[0x00], stats=(1, 1, 1, 1))] * 3, 40),
    "bsw28": (16, [dict(items=[0x13], stats=(50, 50, 99, 50))] + [dict(items=[0x00], stats=(1, 1, 1, 1))] * 3, 40),
    # 5098 (handler 47, item FC) is a monster's action once every ability is used up (06:5A37):
    # WERERATs (one ability, 10 uses) against a party that only defends ({E9}KING) until they flee
    "bsw29": (22, [dict(items=[0x13], stats=(1, 99, 1, 1))] * 4, 300),
    # round 5: 476B (handler 8, the {EC} CORAL / OGRE / DRAGON / SUN swords); tried for 44BC /
    # 44E4 / 44B0 (bsw31: members poked asleep / paralysed; bsw32: a member with no item)
    "bsw30": (39, [dict(items=[0x26]), dict(items=[0x27]), dict(items=[0x28]), dict(items=[0x29])], 60),
    "bsw31": (16, [dict(items=[0x00], status=0x40, stats=(1, 1, 1, 1)), dict(items=[0x00], status=0x80, stats=(1, 1, 1, 1)),
                   dict(items=[0x00], stats=(1, 1, 1, 1)), dict(items=[0x00], stats=(1, 1, 1, 1))], 40),
    "bsw32": (16, [dict(items=[], stats=(50, 50, 99, 50))] + [dict(items=[0x00], stats=(1, 1, 1, 1))] * 3, 40),
    # the statuses that make an actor's turn 44E4 (asleep, bit 7: {EF}SLEEP power 80) or 44BC
    # (paralysed, bit 6: KINESIS power 40); party status bits poked into the records (bsw31) are
    # not enough, as asleep / paralysed members get no turn to execute
    "bsw33": (16, [dict(items=[0x6F], stats=(50, 50, 99, 99)), dict(items=[0xEC], stats=(50, 50, 98, 99)),
                   dict(items=[0x13], stats=(1, 99, 1, 1)), dict(items=[0x13], stats=(1, 99, 1, 1))], 80),
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

# Event sweep (P2): field events of the commands the field sweep did not reach, from
# ffl1/build/event_targets.json (tools/ffl1/event_targets.py): trigger cells (stepped onto, or
# pushed into when blocked) and map objects (talked to), each map entered as in the field sweep,
# then A every 60 frames. Per command a few distinct (map, parameter) targets.
EVENT_SWEEP = {}  # name: (map, kind, x, y)


def _event_sweep():
    import json
    import os
    if not os.path.exists("ffl1/build/event_targets.json"):
        return
    t = json.load(open("ffl1/build/event_targets.json"))
    cells = {0: 99, 1: 99, 2: 99, 4: 99, 7: 99, 0x0A: 99, 0x0B: 99, 0x0C: 99, 0x0E: 99, 0x0F: 12}
    objs = {1: 99, 4: 12, 0x0F: 12, 8: 8, 3: 6, 9: 4}
    for src, kind, limits in ((t["cells"], "reach", cells), (t["objects"], "talk", objs)):
        seen, count = set(), {}
        for mp, x, y, cmd, d in src:
            if cmd not in limits or (cmd, mp, d) in seen or count.get(cmd, 0) >= limits[cmd]:
                continue
            if f"fsw{mp:03d}" not in FIELD_SWEEP:
                continue
            seen.add((cmd, mp, d))
            count[cmd] = count.get(cmd, 0) + 1
            EVENT_SWEEP[f"ev{kind[0]}{cmd:x}_{mp:03d}_{x:02d}{y:02d}"] = (mp, kind, x, y)


_event_sweep()


def _talk_battles():
    """Objects whose talk text (command 0, text = parameter) starts a battle (text codes 00-02
    with event 8): the battle's stack depth from the talk path (evt0 + map)."""
    import json
    import os
    import re
    if not os.path.exists("ffl1/data/text.json"):
        return
    t = json.load(open("ffl1/data/text.json"))["tables"]["dialogue"]["entries"]
    bt = {e["id"] + 16 for e in t if re.search(r"\{0[012] [0-9A-F]8 [0-9A-F]{2}\}", e["text"])}  # text numbers
    seen = set()
    for mp in json.load(open("ffl1/data/maps.json"))["maps"]:
        for e in mp.get("event_list", []):
            if e.get("command") == 0 and e.get("param") in bt and mp["id"] not in seen:
                if f"fsw{mp['id']:03d}" in FIELD_SWEEP:
                    seen.add(mp["id"])
                    EVENT_SWEEP[f"evt0_{mp['id']:03d}_{e['x']:02d}{e['y']:02d}"] = (mp["id"], "talk", e["x"], e["y"])


_talk_battles()
for _n, (_mp, _k, _x, _y) in EVENT_SWEEP.items():
    PLANNED[_n] = ("town0", FIELD, [("wait", 90), (_k, _x, _y)] + [P("a", 60)] * 6 + [("wait", 200)])

# Text event sweep (P2): the events dialogue texts start (codes 00-02 + C3A9 C3AA, 00:0ED2) for
# the commands no map triggers directly (A give item, B park) and a few others, each poked as the
# pending event (C3A9, C3AA, C3AB = 1) at the first town's field loop, then A every 50 frames.
# (Running the texts themselves as event 9 showed nothing: they are sub-texts behind conditions.)
TEXT_SWEEP = {}  # name: (C3A9, C3AA)


def _text_sweep():
    import json
    import os
    import re
    if not os.path.exists("ffl1/data/text.json"):
        return
    t = json.load(open("ffl1/data/text.json"))["tables"]["dialogue"]["entries"]
    limits = {0x0A: 5, 0x0B: 5, 0x07: 3, 0x0E: 3, 0x0F: 3}
    count, seen = {}, set()
    for e in t:
        for mm in re.finditer(r"\{0[012] ([0-9A-F]{2}) ([0-9A-F]{2})\}", e["text"]):
            a9, aa = int(mm.group(1), 16), int(mm.group(2), 16)
            cmd = a9 & 0x0F
            if cmd in limits and count.get(cmd, 0) < limits[cmd] and (a9, aa) not in seen:
                seen.add((a9, aa))
                count[cmd] = count.get(cmd, 0) + 1
                TEXT_SWEEP[f"tsw{cmd:x}_{a9:02x}{aa:02x}"] = (a9, aa)


_text_sweep()


def _talk_texts():
    """Talk events (command 0: window, text C3AA) for the texts that start a battle (tsb + the
    text number C3AA): the stack depth of a battle started from a talk. 00:3475 reads text n at
    05:7B10 + 2n while the dialogue table (M3) starts at 05:7B30: entry k is text k + 16."""
    import json
    import os
    import re
    if not os.path.exists("ffl1/data/text.json"):
        return
    for e in json.load(open("ffl1/data/text.json"))["tables"]["dialogue"]["entries"]:
        if re.search(r"\{0[012] [0-9A-F]8 [0-9A-F]{2}\}", e["text"]) and e["id"] + 16 < 0x100:
            TEXT_SWEEP[f"tsb0_00{e['id'] + 16:02x}"] = (0x00, e["id"] + 16)


_talk_texts()
for _n in TEXT_SWEEP:
    PLANNED[_n] = ("town0", FIELD, [("wait", 30)] + [P("a", 50)] * 12 + [("wait", 200)])


def POKES_FSW(w):
    """The warp event w poked at the field loop (C5BA = 0: a fresh map ignores warps until a step)."""
    return [(0xC5BA, 0x00), (0xC3A9, 0x06 if w >= 0x100 else 0x05), (0xC3AA, w & 0xFF), (0xC3AB, 0x01)]


# Fixture pokes applied at the hook (address, value[, mask]), by the planner and the recorder alike.
POKES = {
    **{_n: battle_pokes(_area, _ms) for _n, (_area, _ms, _k) in SWEEP.items()},
    **{_n: POKES_FSW(_w) for _n, _w in FIELD_SWEEP.items()},
    **{f"sfx{_i:02d}": [(0xFFE4, _i)] for _i in range(1, SFX_COUNT + 1)},
    **{f"jng{_j:02x}": [(0xFFE2, _j)] for _j in JINGLES},
    **{_n: POKES_FSW(FIELD_SWEEP[f"fsw{_mp:03d}"]) for _n, (_mp, *_r) in EVENT_SWEEP.items()},
    **{_n: [(0xC3A9, _a9), (0xC3AA, _aa), (0xC3AB, 0x01)] for _n, (_a9, _aa) in TEXT_SWEEP.items()},
    "flee2": battle_pokes(22, [dict(items=[0x13], stats=(1, 99, 1, 1))]
                          + [dict(items=[0x13], hp=0, status=0x01)] * 3),
    "care1": [(0xCC0F, 0x84), (0xCC10, 0x05), (0xCC06, 0x0A), (0xCC07, 0x00)],
    "battle1": [(0xC3A9, 0x08), (0xC3AA, 0x10), (0xC3AB, 0x01)],
    "flee1": battle_pokes(16, [dict(items=[0x37])] * 4),
    "defeat1": battle_pokes(16, [dict(items=[0x00], hp=1, stats=(1, 1, 1, 1))] * 4),
    "battle2": [(0xC3A9, 0x08), (0xC3AA, 0x10), (0xC3AB, 0x01)],
}


# The input sweep: seeded random single-button input (the plan is fixed text, the same on both
# sides) with random items poked into the party (8 slots each) and the bag (CC7C, 8 pairs), from
# the first town's field loop: ybNN a battle (area by the seed), yfNN the field of a map warped to
# (FIELD_SWEEP), ysNN a facility (command 4: shops 00-18, inn F0, house of life F1, guild F2-FF).
# Reaches the menus, item uses, selling, meat and the battle choices the planned sweeps skip.
def fuzz_plan(seed, n, keys):
    import random
    r = random.Random(seed)
    names, weights = [k for k, _ in keys], [w for _, w in keys]
    out = ["none:10"]
    for _ in range(n):
        k = r.choices(names, weights)[0]
        hold = 3 if k in ("a", "b", "start", "select") or r.random() < 0.6 else r.randint(8, 24)
        out += [f"{k}:{hold}", f"none:{r.randint(10, 40)}"]
    out.append("none:200")
    return ",".join(out)


FUZZ_BATTLE_KEYS = (("a", 7), ("b", 2), ("up", 2), ("down", 3), ("left", 1), ("right", 2))
FUZZ_FIELD_KEYS = (("a", 5), ("b", 2), ("up", 3), ("down", 3), ("left", 3), ("right", 3), ("start", 2), ("select", 1))
FUZZ_FACILITY_KEYS = (("a", 5), ("b", 2), ("up", 2), ("down", 3), ("left", 1), ("right", 2))
FUZZ_AREAS = sorted({_a for _a, _ms, _k in SWEEP.values()})
FUZZ_FACILITIES = list(range(0x00, 0x19)) + [0xF0, 0xF1] + list(range(0xF2, 0x100))


def fuzz_party(seed):
    import random
    r = random.Random(seed)
    p = []
    for i in range(4):
        items = [r.randrange(0, 0xFF) for _ in range(8)]
        flags = (0x83, 0x23, 0x43, 0x83)[(seed + i) % 4]
        p += member(i, items, hp=r.choice((999, 300, 40)), flags=flags, cls=r.randrange(0, 0xC8),
                    stats=tuple(r.randrange(5, 99) for _ in range(4)))
    for k in range(8):
        iid = r.randrange(0, 0xFF)
        p += [(0xCC7C + 2 * k, iid), (0xCC7D + 2 * k, _uses(iid))]
    gp = r.choice((0x999999, 0x000120, 0x050000))
    p += [(0xCC8D, gp & 0xFF), (0xCC8E, (gp >> 8) & 0xFF), (0xCC8F, gp >> 16)]
    return p


def fuzz_sweep(nb=48, nf=48, ns=len(FUZZ_FACILITIES)):
    maps = sorted(FIELD_SWEEP)
    for j in range(nb):
        a = FUZZ_AREAS[(j * 7) % len(FUZZ_AREAS)]
        SCENARIOS[f"yb{j:02d}"] = ("town0", FIELD, fuzz_plan(5000 + j, 160, FUZZ_BATTLE_KEYS))
        POKES[f"yb{j:02d}"] = fuzz_party(j) + [(0xC3A9, 0x08), (0xC3AA, a), (0xC3AB, 0x01)]
    for j in range(nf):
        SCENARIOS[f"yf{j:02d}"] = ("town0", FIELD, fuzz_plan(6000 + j, 160, FUZZ_FIELD_KEYS))
        POKES[f"yf{j:02d}"] = fuzz_party(100 + j) + POKES_FSW(FIELD_SWEEP[maps[(j * 13) % len(maps)]])
    for j in range(ns):
        SCENARIOS[f"ys{j:02d}"] = ("town0", FIELD, fuzz_plan(7000 + j, 120, FUZZ_FACILITY_KEYS))
        POKES[f"ys{j:02d}"] = fuzz_party(200 + j) + [(0xC3A9, 0x04), (0xC3AA, FUZZ_FACILITIES[j]), (0xC3AB, 0x01)]


fuzz_sweep()


# The item sweep (yiXXv): each field-usable item (06:7700 byte 0 bit 1; effects 00:3739 for 00-17,
# 00:3769 for abilities 80-86) in every member's slots and the bag, members hurt and with a status
# by the seed, then seeded input weighted to A and the menu: the field effects the input sweep's
# random items rarely reach (heal, cure, restore, heart, stat and HP ups, recharge, combine, the
# spheres, the event items, teleport).
FIELD_USE_ITEMS = list(range(0x00, 0x18)) + list(range(0x80, 0x87))
FUZZ_ITEM_KEYS = (("a", 7), ("b", 1), ("up", 2), ("down", 3), ("right", 1), ("start", 1))


def item_party(seed, iid):
    import random
    r = random.Random(seed)
    partner = {0x15: 0x16, 0x16: 0x15}.get(iid, iid)
    p = []
    for i in range(4):
        items = [iid] * 6 + [partner, iid]
        p += member(i, items, hp=r.choice((999, 300, 120)), flags=(0x83, 0x23, 0x43, 0x83)[i],
                    cls=r.randrange(0, 0xC8), stats=tuple(r.randrange(5, 99) for _ in range(4)),
                    status=r.choice((0x00, 0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40)))
        p += [(0xCC00 + 31 * i + 6, r.choice((1, 10, 60)))]  # current HP below the maximum
    for k in range(8):
        it = partner if k == 1 else iid
        p += [(0xCC7C + 2 * k, it), (0xCC7D + 2 * k, _uses(it))]
    return p


def item_sweep(variants=2):
    for iid in FIELD_USE_ITEMS:
        for v in range(variants):
            n = f"yi{iid:02x}{v}"
            seed = 8000 + iid * 4 + v
            SCENARIOS[n] = ("town0", FIELD, "none:10,start:3,none:30," + fuzz_plan(seed, 140, FUZZ_ITEM_KEYS))
            POKES[n] = item_party(seed, iid)


item_sweep()


# The growth sweep (ygNN): battles the party wins (the strongest weapons 3C, 3F, 46, 48; A every
# 37-41 frames; area 16, the first world zone) with two monsters (flags 43) and two mutants (flags
# 23: the battle record's race +00 & C0 = 40): the mutants' growth (06:539E: a new ability, HP,
# stats, uses) and the monsters' meat.
def growth_sweep(n=16):
    for j in range(n):
        ms = [dict(items=[0x3C, 0x48], flags=0x43, stats=(99, 99, 99, 99), cls=0x10 + j),
              dict(items=[0x3F, 0x46], flags=0x43, stats=(90, 99, 80, 99), cls=0x30 + j),
              dict(items=[0x3C, 0x3F], flags=0x23, stats=(99, 99, 99, 50), cls=0x50 + 3 * j),
              dict(items=[0x48, 0x46], flags=0x23, stats=(99, 99, 99, 50), cls=0x80 + 3 * j)]
        gap = 37 + j % 5
        SCENARIOS[f"yg{j:02d}"] = ("town0", FIELD, "none:60," + f"a:3,none:{gap}," * 110 + "none:300")
        # the 128 random counters (C300, one per call site: 00:0018) seeded by the index, so the
        # growth rolls (06:53B8: C30B) and the meat differ from battle to battle
        import random
        rr = random.Random(9000 + j)
        POKES[f"yg{j:02d}"] = battle_pokes(16, ms) + [(0xC300 + k, rr.randrange(256)) for k in range(0x80)]


growth_sweep()


# The reaction sweep (yrNN): every member's first item a reaction (06:45FC, field 1 bits 1, 2, 4:
# reflect 33 / 79, inflict CD-CF, spikes D0), chosen each round (A only), the enemies attacking.
REACTION_ITEMS = (0x33, 0x79, 0xCD, 0xCE, 0xCF, 0xD0)


def reaction_sweep():
    for j in range(2 * len(REACTION_ITEMS)):
        iid = REACTION_ITEMS[j % len(REACTION_ITEMS)]
        a = FUZZ_AREAS[(j * 3 + 1) % len(FUZZ_AREAS)]
        # (the reflect needs an attack that does damage: all stats 1 in the first six)
        ms = [dict(items=[iid, 0x2E], stats=(1, 1, 1, 1) if j < len(REACTION_ITEMS) else (20, 99, 99, 20), hp=999) for _ in range(4)]
        SCENARIOS[f"yr{j:02d}"] = ("town0", FIELD, "none:60," + "a:3,none:39," * 100 + "none:200")
        POKES[f"yr{j:02d}"] = battle_pokes(a, ms)


reaction_sweep()

# The sale sweep (yvNN): shops (command 4, 00-18) with every item worn (uses 1 .. full - 1, by
# the seed): the sale price of a used item (00:330B: price * (uses * 16 / full) / 32, BCD digits).
def sale_sweep(n=12):
    import random
    for j in range(n):
        r = random.Random(9500 + j)
        p = []
        for i in range(4):
            items = [r.randrange(0x18, 0x80) for _ in range(8)]
            p += member(i, items, hp=500, flags=(0x83, 0x23, 0x43, 0x83)[i])
            for k, iid in enumerate(items):
                full = _uses(iid)
                if 1 < full < 0xFE:
                    p.append((0xCC00 + 31 * i + 0x10 + 2 * k, r.randrange(1, full)))
        for k in range(8):
            iid = r.randrange(0x18, 0x80)
            full = _uses(iid)
            p += [(0xCC7C + 2 * k, iid), (0xCC7D + 2 * k, r.randrange(1, full) if 1 < full < 0xFE else full)]
        SCENARIOS[f"yv{j:02d}"] = ("town0", FIELD, fuzz_plan(9600 + j, 120, (("a", 6), ("b", 1), ("down", 3), ("up", 1))))
        POKES[f"yv{j:02d}"] = p + [(0xC3A9, 0x04), (0xC3AA, (j * 2) % 0x19), (0xC3AB, 0x01)]


sale_sweep()

# The spheres (bag row 9, 00:2810; progress nibble 0A = the count, CC96 high): sphere1 uses one
# (nibble 4 = a + 5, the objects, the quake 00:1Bxx); sphere2 with the story at stage 2 (nibble 0,
# CC91 high) on map 1: every sphere shown, the shakes, nibble 0A = 5
PLAN_SPHERES = ("none:30,start:3,none:40,right:3,none:15,a:3,none:40," + "down:3,none:12," * 9
                + "a:3,none:60,a:3,none:240,down:3,none:12,a:3,none:240,b:3,none:40,b:3,none:40,b:3,none:60")
# (empty1: the menu's Save, then Abil, the member choice on the empty slots 1-3: 00:2977 asks again
# with bc = CC00 + the record offset as the page window)
SCENARIOS["empty1"] = ("town0", FIELD, PLAN_SPHERES.replace("right:3", "down:3", 1))
SCENARIOS["sphere1"] = ("town0", FIELD, PLAN_SPHERES)
POKES["sphere1"] = [(0xCC96, 0x30, 0xF0)]
SCENARIOS["sphere2"] = ("town0", FIELD, PLAN_SPHERES)
POKES["sphere2"] = [(0xCC96, 0x40, 0xF0), (0xCC91, 0x20, 0xF0)]

def plan_for(name):
    if name in SCENARIOS:
        return SCENARIOS[name]
    state, hook, actions, *save = PLANNED[name]
    p = Planner(state, hook, pokes=POKES.get(name, ()))
    p.run(actions, max_frames=2500 if name in EVENT_SWEEP or name in TEXT_SWEEP else None)
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
