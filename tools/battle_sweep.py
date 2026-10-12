"""Battle parity sweeps (P3): lean PyBoy traces (tools/trace_lib.py) that start at the entry of the
battle main loop 0D:4000 and end at the return of its far call (mark 00:0EF4, 30 frames later),
replayed by port/packages/parity/test/battle_sweep.test.ts through replayBattle.

Every case starts from build/states/pre_battle_id45.state (the field script's battle call); at
the hook the party records (C200 + 32·n: id, type, status, HP, stats, 8 × [item, uses]), the
formation (CFE0-CFE5 counts/ids, CFE9 music, CFEA flags), the guest switch (progress variable
0, C2F6 high nibble) and the RNG stream counters (C0A0-C0AF) are written, so the original runs
the whole battle from that situation. The battle's last wait for a button (0D:4152, after
victory, defeat or escape) compares the buttons with the value read on entry, which the original
reads after however much CPU time the computation before it took (the frame model places the read
at the start of its segment), so a button change around that point would make the exit frame
depend on CPU time. So the plan switches to no buttons when the growth script starts (0D:4349),
at the defeat (0D:4251) and at the escape (0D:4143), and on entry to 0D:4152 to 12 frames
without buttons, then A.
  items              every battle-usable id (0C:6F80 + 8·id bit 0) in slot 0 of all four members,
                     A pressed throughout (FIGHT, slot 0, default target). Traces bs_i_NNN.
  enemies            every enemy id 0-255 as group 1 (two of it) and a party that lasts (HP 999,
                     DEF 60): the enemy AI and the enemies' abilities. Traces bs_e_NNN.
  types              parties of one type each (human, mutant, monster, robot) with their own
                     kinds of abilities, against ordinary enemies, A pressed: growth (script 10)
                     and meat (script 9) after victories. Traces bs_t_K_NNN.
  focus              every battle-usable id again, three seeds each: all four members carry it in
                     slot 0 next to random items, random types/stats/statuses, MAGI, random
                     formations, mostly-A plans. Traces bs_f_NNN_S.
  mix                like random, with MAGI held (C2DA owner/count, member blocks +2A-2C),
                     more statuses and the rarer effects (steal, explode, saws, smasher, multiply,
                     DNA) in the item mix. Traces bs_m_NNNN.
  random             random parties (types, items, stats, statuses), random formations, guest on
                     or off, random RNG counters and random button plans. Traces bs_r_NNNN.
FROM TO select cases by index; --n N sets the number of random cases (default 400), --seeds N
the cases per type (default 8).
Usage: python tools/battle_sweep.py MODE [FROM TO] [--redo] [--only FILE] [--n N] [--seeds N]"""
import json, os, random, signal, sys, time
sys.path.insert(0, "tools")
from trace_lib import Recorder, plan_steps

STATE = "pre_battle_id45"
HOOK = (0x0D, 0x4000)
MARK = (0x00, 0x0EF4)
QUIET = plan_steps("none:3000")
SWITCH = [((0x0D, 0x4349), QUIET), ((0x0D, 0x4251), QUIET), ((0x0D, 0x4143), QUIET),
          ((0x0D, 0x4152), plan_steps("none:12,a:4,none:120"))]
ROM = open("input/original.gb", "rb").read()
R = lambda b, a: ROM[b * 0x4000 + a - 0x4000] if b else ROM[a]
USABLE = [i for i in range(256) if R(0x0C, 0x6F80 + 8 * i) & 1]
MAXUSES = lambda i: R(0x0C, 0x7E80 + i)
MASH = ",".join(["a:2,none:4"] * 700)  # 4200 frames


def monster_abilities(mid):
    """Ability ids of monster record 0D:6F80 + 10·id (count = byte 0 low nibble + 1, pointer 8-9)."""
    rec = 0x6F80 + 10 * mid
    n = (R(0x0D, rec) & 0x0F) + 1
    p = R(0x0D, rec + 8) | (R(0x0D, rec + 9) << 8)
    return [R(0x0D, p + k) if p < 0x8000 else 0xFF for k in range(n)]


def member(n, mid, typ, hp, stats, items, status=0, maxhp=None):
    """Pokes for party record n: id, type, status, HP (cur, max), STR/AGL/MANA/DEF, 8 items."""
    b = 0xC200 + 32 * n
    maxhp = hp if maxhp is None else maxhp
    p = [(b + 4, mid), (b + 5, typ), (b + 6, status), (b + 7, hp & 0xFF), (b + 8, hp >> 8),
         (b + 9, maxhp & 0xFF), (b + 10, maxhp >> 8)] + [(b + 11 + k, v) for k, v in enumerate(stats)]
    items = (list(items) + [(0xFF, 0xFF)] * 8)[:8]
    for k, (i, u) in enumerate(items):
        p += [(b + 15 + 2 * k, i), (b + 16 + 2 * k, u)]
    return p


def formation(groups, flags=0, music=0):
    """CFE0-CFE5: (count, id) for three groups; CFE9 music bits, CFEA flags (D844)."""
    groups = (list(groups) + [(0, 0)] * 3)[:3]
    p = []
    for g, (c, i) in enumerate(groups):
        p += [(0xCFE0 + 2 * g, c), (0xCFE1 + 2 * g, i)]
    return p + [(0xCFE9, music), (0xCFEA, flags)]


def rng_pokes(rng):
    return [(0xC0A0 + k, rng.randrange(256)) for k in range(16)]


def random_plan(rng, frames=5000):
    out, n = [], 0
    keys = ["a"] * 10 + ["down"] * 3 + ["up"] * 2 + ["right"] * 2 + ["left"] + ["b"] * 2
    while n < frames:
        k, gap = rng.choice(keys), rng.randint(2, 7)
        out.append(f"{k}:2,none:{gap}")
        n += 2 + gap
    return ",".join(out)


def human_items(rng):
    pool = [i for i in USABLE if i < 0x80]
    return [(i, MAXUSES(i) or 1) for i in rng.sample(pool, rng.randint(2, 8))]


def mutant_items(rng):
    pool = [i for i in USABLE if i < 0x80]
    abil = [i for i in USABLE if i >= 0x80]
    return [(i, MAXUSES(i) or 1) for i in rng.sample(pool, rng.randint(1, 4))] + \
        [(i, MAXUSES(i) or 1) for i in rng.sample(abil, rng.randint(1, 4))]


def monster_member(rng):
    mid = rng.randrange(0, 0xC0)
    return mid, [(i, MAXUSES(i) or 0xFE) for i in monster_abilities(mid)]


def _opt(name, default):
    return int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


RARE = [221, 222, 74, 150, 253, 229, 89, 18, 149, 152, 165, 151, 112, 216, 247, 248, 249, 250, 252]


def magi_pokes(rng, p=0.5):
    """MAGI held: C2DA + 2i = owner (member + 1) << 4 | count, C2DB + 2i = uses; one per member."""
    out = [(0xC2DA + 2 * i, 0) for i in range(14)]
    idx = rng.sample(range(14), 5)
    for n in range(5):
        if rng.random() < p:
            out += [(0xC2DA + 2 * idx[n], ((n + 1) << 4) | rng.randint(1, 15)), (0xC2DB + 2 * idx[n], rng.randint(1, 12))]
    return out


def random_party(rng, extra=(), st_p=0.2):
    pokes = []
    for n in range(4):
        t = rng.choice([0, 0, 1, 2, 3])
        if t == 0:
            mid, items = 240 + rng.randint(0, 1), human_items(rng)
        elif t == 1:
            mid, items = 242 + rng.randint(0, 1), mutant_items(rng)
        elif t == 2:
            mid, items = monster_member(rng)
        else:
            mid, items = 244, human_items(rng)
        items = list(extra) + items
        maxhp = rng.randint(20, 999)
        hp = maxhp if rng.random() < 0.7 else rng.randint(1, maxhp)
        st = 0 if rng.random() > st_p else rng.choice([0x01, 0x02, 0x04, 0x08, 0x20, 0x40, 0x80, 0x10, 0x03, 0x60])
        pokes += member(n, mid, t, hp, tuple(rng.randint(1, 99) for _ in range(4)), items, st, maxhp)
    return pokes


def random_formation(rng):
    ng = rng.choice([1, 1, 2, 2, 3])
    groups = [(rng.choice([1, 1, 2, 2, 3, 4, 5, 6]), rng.randrange(256)) for _ in range(ng)]
    return formation(groups, rng.choice([0, 0, 0, 1, 2, 4, 8, 16, 32, 33, 45, 96]), rng.randint(0, 3))


def cases(mode):
    if mode == "items":
        for i in USABLE:
            rng = random.Random(1000 + i)
            pokes = []
            for n in range(4):
                pokes += member(n, 240 + (n & 1), 0, 400, (30, 30, 30, 30), [(i, 20), (0x01, 0xFE)])
            enemy = rng.choice([45, 120, 165, 180, 185, 60, 90, 30])
            pokes += formation([(2, enemy), (2, rng.randrange(0, 0x80))])
            yield f"bs_i_{i:03d}", pokes + rng_pokes(rng), MASH
    elif mode == "enemies":
        for e in range(256):
            rng = random.Random(2000 + e)
            pokes = []
            for n in range(4):
                pokes += member(n, 240 + (n & 1), 0, 999, (20, 20, 20, 60), [(0x01, 0xFE)])
            pokes += formation([(2, e)])
            yield f"bs_e_{e:03d}", pokes + rng_pokes(rng), MASH
    elif mode == "types":
        seeds = _opt("--seeds", 8)
        for t in range(4):
            for s in range(seeds):
                rng = random.Random(3000 + 100 * t + s)
                pokes = []
                for n in range(4):
                    if t == 0:
                        mid, items = 240 + (n & 1), human_items(rng)
                    elif t == 1:
                        mid, items = 242 + (n & 1), mutant_items(rng)
                    elif t == 2:
                        mid, items = monster_member(rng)
                    else:
                        mid, items = 244, human_items(rng)
                    hp = rng.randint(150, 600)
                    pokes += member(n, mid, t, hp, tuple(rng.randint(10, 60) for _ in range(4)), items)
                pokes += formation([(rng.randint(1, 3), rng.randrange(0, 0x80)), (rng.randint(0, 2), rng.randrange(0, 0x80))])
                yield f"bs_t_{t}_{s:03d}", pokes + rng_pokes(rng), MASH
    elif mode == "focus":
        for i in USABLE:
            for sd in range(3):
                rng = random.Random(40000 + 10 * i + sd)
                pokes = random_party(rng, [(i, MAXUSES(i) or 9)]) + random_formation(rng) + magi_pokes(rng, 0.3)
                yield f"bs_f_{i:03d}_{sd}", pokes + rng_pokes(rng), random_plan(rng)
    elif mode == "mix":
        for sd in range(_opt("--n", 400)):
            rng = random.Random(30000 + sd)
            rare = [(rng.choice(RARE), rng.randint(1, 9))] if rng.random() < 0.6 else []
            pokes = random_party(rng, rare, 0.35) + random_formation(rng) + magi_pokes(rng)
            if rng.random() < 0.3:
                pokes.append((0xC2F6, 0x00, 0xF0))
            yield f"bs_m_{sd:04d}", pokes + rng_pokes(rng), random_plan(rng)
    elif mode == "random":
        for s in range(_opt("--n", 400)):
            rng = random.Random(10000 + s)
            pokes = []
            for n in range(4):
                t = rng.choice([0, 0, 1, 2, 3])
                if t == 0:
                    mid, items = 240 + rng.randint(0, 1), human_items(rng)
                elif t == 1:
                    mid, items = 242 + rng.randint(0, 1), mutant_items(rng)
                elif t == 2:
                    mid, items = monster_member(rng)
                else:
                    mid, items = 244, human_items(rng)
                maxhp = rng.randint(20, 999)
                hp = maxhp if rng.random() < 0.7 else rng.randint(1, maxhp)
                st = 0 if rng.random() < 0.8 else rng.choice([0x01, 0x02, 0x04, 0x08, 0x20, 0x40, 0x80, 0x10])
                pokes += member(n, mid, t, hp, tuple(rng.randint(1, 99) for _ in range(4)), items, st, maxhp)
            ng = rng.choice([1, 1, 2, 2, 3])
            groups = [(rng.choice([1, 1, 2, 2, 3, 4, 5, 6]), rng.randrange(256)) for _ in range(ng)]
            flags = rng.choice([0, 0, 0, 1, 2, 4, 8, 16, 32, 33, 45, 96])
            pokes += formation(groups, flags, rng.randint(0, 3))
            if rng.random() < 0.3:
                pokes.append((0xC2F6, 0x00, 0xF0))  # guest off (progress variable 0 = 0)
            yield f"bs_r_{s:04d}", pokes + rng_pokes(rng), random_plan(rng)


def _timeout(*_):
    raise TimeoutError("emulator did not finish the case in 60 s")


def main():
    signal.signal(signal.SIGALRM, _timeout)
    mode = sys.argv[1]
    nums = [int(x) for x in sys.argv[2:4] if x.isdigit()]
    lo, hi = (nums + [0, 10 ** 6])[0], (nums[1:] + [10 ** 6])[0]
    only = set(open(sys.argv[sys.argv.index("--only") + 1]).read().split()) if "--only" in sys.argv else set()
    if mode == "list":
        for n, c in enumerate(cases(sys.argv[2])):
            print(n, c[0])
        return
    rec, t0 = Recorder(), time.time()
    try:
        for n, (name, pokes, plan) in enumerate(cases(mode)):
            if not lo <= n < hi or (only and name not in only):
                continue
            if "--redo" not in sys.argv and os.path.exists(f"build/traces/{name}/marks.json") and \
                    json.load(open(f"build/traces/{name}/trace.json")).get("plan") == plan:
                continue
            signal.alarm(60)
            try:
                f, w = rec.record(name, STATE, plan_steps(plan), hook=HOOK, pokes=pokes, plan=plan,
                                  marks=[MARK], stop_after=30, switch=SWITCH)
                print(f"{name} {f} frames {w} waits {time.time() - t0:.0f}s", flush=True)
            except Exception as ex:  # noqa: BLE001 - keep sweeping
                print(f"{name} FAILED {ex}", flush=True)
                if isinstance(ex, TimeoutError):
                    rec = Recorder()
            finally:
                signal.alarm(0)
    finally:
        rec.close()


if __name__ == "__main__":
    main()
