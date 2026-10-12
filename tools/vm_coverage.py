"""Calc-VM coverage of the battle sweeps: which statements of the bank-0C bytecode the port executed
while replaying traces (build/sweep/cov/*.json "vm", written with COVERAGE=1 by the parity tests),
per battle script (0-10), per battle effect handler (0C:53E1 table, 50 entries) and per field
effect handler (0C:5445, 10). Statement addresses come from data/battle/calcvm_listing.txt.
Usage: python tools/vm_coverage.py [GLOB] (default build/sweep/cov/*.json) [--json OUT]"""
import glob, json, re, sys

pat = next((a for a in sys.argv[1:] if not a.startswith("--") and "*" in a), "build/sweep/cov/*.json")
ran = set()
for f in glob.glob(pat):
    ran.update(json.load(open(f)).get("vm", []))

# listing: labels ("script_N:", "effect_N:", "L4F85:") then statements "  ADDR  text"
blocks, cur, stmts = {}, None, []
for line in open("data/battle/calcvm_listing.txt"):
    m = re.match(r"^(\w+):", line)
    if m:
        cur = m.group(1)
        if cur.startswith(("script_", "effect_", "field_effect_")):
            blocks.setdefault(cur, [])
        continue
    m = re.match(r"^  ([0-9A-F]{4})  (.*)", line)
    if m:
        a = int(m.group(1), 16)
        stmts.append(a)
        top = [k for k in blocks if k == cur]
        if top:
            blocks[cur].append(a)

rules = json.load(open("data/battle/rules_tables.json"))["effects"]
entries = {int(k): int(v["battle_handler"].split(":")[1], 16) for k, v in rules.items()}
fentries = {int(k): int(v["field_handler"].split(":")[1], 16) for k, v in rules.items() if v.get("field_handler")}
hit = [k for k, a in sorted(entries.items()) if a in ran]
miss = [k for k in sorted(entries) if entries[k] not in ran]
print(f"battle effect handlers entered: {len(hit)}/{len(entries)}; never: {' '.join(map(str, miss)) or '-'}")
fhit = [k for k, a in sorted(fentries.items()) if a in ran]
print(f"field effect handlers entered (battle sweeps do not use them): {len(fhit)}/{len(fentries)}")
scripts = {n: int(open('input/original.gb', 'rb').read()[0x0C * 0x4000 + 0x4680 - 0x4000 + 2 * n:][0:2][::-1].hex(), 16) for n in range(11)}
print("battle scripts entered:", " ".join(f"{n}" for n, a in scripts.items() if a in ran), "| never:", " ".join(f"{n}" for n, a in scripts.items() if a not in ran) or "-")
battle_stmts = [a for a in stmts if a < 0x6580 or a >= 0x6700]  # bank-0C battle code (field handlers 658A-66FF excluded)
cov = sum(1 for a in battle_stmts if a in ran)
print(f"statements executed: {cov}/{len(battle_stmts)} ({100 * cov / len(battle_stmts):.1f}%) of the battle bytecode")
if "--json" in sys.argv:
    json.dump({"handlers_entered": hit, "handlers_never": miss, "statements": [cov, len(battle_stmts)],
               "never": [f"{a:04X}" for a in battle_stmts if a not in ran]},
              open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)
