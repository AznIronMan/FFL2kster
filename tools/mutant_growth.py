"""Controlled change: which growth-parameter pair does script 10 read for a stat of a human (type 0)
or a mutant (type 1)? (docs/BATTLE_RULES.md, open question "mutant growth".)

The VM listing has `CF94 = CF89 * #5 + CF61 * #2 + #$7F94` (0C:5197); the calc VM evaluates left to
right, so the address would be 7F94 + 10·type + 2·stat, which for a mutant lands STR on the two
zero bytes after the human record (7F9E) instead of 7FA4 (= 7F94 + 16·type + 2·stat).

Setup: build/states/pre_battle_id45.state at the battle entry 0D:4000; four members of one type,
max HP --hp (use 100), member k's stat k = 1 and its other stats 50, guest off; member k uses an
item whose action flags (0C:7B40 + id) name stat k only: Long (STR), Rapier (AGL), Fire (MANA),
Bronze shield (DEF); two groups of four enemy 45 (level 1), HP 1 and AGL/DEF 0 from the start of
the battle screen (0F:6080), so every member acts in the first round and the battle ends soon
after. The ROM copy (build/, deleted afterwards) has every candidate pair of the type zeroed, then
one address set to (b0, b1) = (0, 200): for a stat of 1 that is chance 160/201, while the ability
and HP checks stay at 0 at max HP 100 (penalty 1·200 = 200; at 999 the one-byte penalty is only 72
and they fire, see rules.hp_penalty). A stat that grows in most trials reads the patched address.
Output: build/evidence/mutant_growth_hpN.json and a table.
Usage: python tools/mutant_growth.py [TRIALS] [--hp N]  (P3 result: TRIALS 10, --hp 100)"""
import json, os, random, sys
sys.path.insert(0, "src"); sys.path.insert(0, "tools")
from ffl2kster.emu import Emulator

ROM = open("input/original.gb", "rb").read()
OFF = lambda a: 0x0C * 0x4000 + a - 0x4000
ACTIONS = [0x01, 0x0F, 0x26, 0x17]  # Long (STR), Rapier (AGL), Fire (MANA), Bronze shield (DEF)
TYPES = {0: (240, range(0x7F92, 0x7FA0, 2)), 1: (242, range(0x7F9E, 0x7FAC, 2))}
TRIALS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 6
HP = int(sys.argv[sys.argv.index("--hp") + 1]) if "--hp" in sys.argv else 999


def rom_variant(typ, addr):
    b = bytearray(ROM)
    for a in TYPES[typ][1]:
        b[OFF(a)] = b[OFF(a) + 1] = 0
    if addr is not None:
        b[OFF(addr)], b[OFF(addr) + 1] = 0, 200
    path = f"build/mg_{typ}_{addr or 0:04x}.gb"
    open(path, "wb").write(b)
    return path


def run(path, typ, seed):
    rng = random.Random(seed)
    mid = TYPES[typ][0]
    pokes = [(0xCFE0, 4), (0xCFE1, 45), (0xCFE2, 4), (0xCFE3, 45), (0xCFE4, 0), (0xCFEA, 0)]
    for n in range(4):
        b = 0xC200 + 32 * n
        pokes += [(b + 4, mid + (n & 1)), (b + 5, typ), (b + 6, 0), (b + 7, HP & 0xFF), (b + 8, HP >> 8), (b + 9, HP & 0xFF), (b + 10, HP >> 8)]
        pokes += [(b + 11 + k, 1 if k == n else 50) for k in range(4)]  # the measured stat 1, the rest 50
        pokes += [(b + 15, ACTIONS[n]), (b + 16, 0xFE)] + [(b + 17 + k, 0xFF) for k in range(14)]
    pokes += [(0xC0A0 + k, rng.randrange(256)) for k in range(16)]
    with Emulator(path) as e:
        pb = e.pb
        e.load_state("build/states/pre_battle_id45.state")
        st, done = [], []

        def at_entry(_):
            if not st:
                for a, v in pokes:
                    pb.memory[a] = v
                pb.memory[0xC2F6] &= 0x0F  # guest off
                st.append(1)

        def at_ret(_):
            if st and not done:
                done.append([pb.memory[0xC200 + 32 * n + 11 + n] for n in range(4)] +
                            [pb.memory[0xC200 + 32 * n + 9] | (pb.memory[0xC200 + 32 * n + 10] << 8) for n in range(4)] +
                            [[pb.memory[0xC200 + 32 * n + 15 + 2 * k] for k in range(8)] for n in range(4)])
        def at_screen(_):
            if st and len(st) == 1:
                for g in (0xD5, 0xD6):
                    for i in range(4):
                        pb.memory[(g << 8) | (0x41 + 8 * i)], pb.memory[(g << 8) | (0x42 + 8 * i)] = 1, 0
                    pb.memory[(g << 8) | 0x0F] = pb.memory[(g << 8) | 0x11] = 0
                st.append(2)
        dbg = {}

        def at_growth(_):
            if st and not dbg:
                m = pb.memory
                dbg.update(last=[m[0xD84D + i] for i in range(10)], c2a0=m[0xC2A0], types=[m[0xD00B + 0x100 * n] for n in range(5)],
                           status=[m[0xD040 + 0x100 * n] for n in range(5)], d50a=m[0xD50A])
        pb.hook_register(0x0D, 0x4000, at_entry, None)
        pb.hook_register(0x0F, 0x6080, at_screen, None)
        pb.hook_register(0x0D, 0x4349, at_growth, None)
        pb.hook_register(0x00, 0x0EF4, at_ret, None)
        for f in range(20000):
            if f % 6 < 2:
                pb.button_press("a")
            else:
                pb.button_release("a")
            pb.tick(1, False)
            if done:
                break
        if not done:
            raise RuntimeError("battle did not return")
        stats, hps, items = done[0][:4], done[0][4:8], done[0][8:]
        if os.environ.get("MGDEBUG"):
            print(dbg, stats, items)
        return {"stat_delta": [s - 1 for s in stats],
                "new_ability": [any(i not in (ACTIONS[n], 0xFF) for i in items[n]) for n in range(4)],
                "hp_gain": [h - HP for h in hps]}


def main():
    out = {"trials": TRIALS, "hp": HP, "results": []}
    for typ in (0, 1):
        for addr in [None] + list(TYPES[typ][1]):
            path = rom_variant(typ, addr)
            grow = [0, 0, 0, 0]
            other = [0, 0]
            for t in range(TRIALS):
                r = run(path, typ, 1000 * typ + t)
                for n in range(4):
                    grow[n] += r["stat_delta"][n] > 0
                    other[0] += r["hp_gain"][n] > 0
                    other[1] += r["new_ability"][n]
            os.remove(path)
            row = {"type": typ, "patched": None if addr is None else f"0C:{addr:04X}",
                   "grew": dict(zip(["STR", "AGL", "MANA", "DEF"], grow)), "hp_gains": other[0], "abilities": other[1]}
            out["results"].append(row)
            print(row, flush=True)
    os.makedirs("build/evidence", exist_ok=True)
    json.dump(out, open(f"build/evidence/mutant_growth_hp{HP}.json", "w"), indent=1)


if __name__ == "__main__":
    main()
