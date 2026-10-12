"""Empirically measure meat transformations: for one representative eater per family code
(first monster id with that code in 0D:6B70) and every meat id 0-179, set the eater id in the
battle copy (D00A, also C204/C742) and the meat id (CF10) at the meat prompt and record the resulting monster id.
usage: meat_matrix.py ROM OUT.json FIRST_FAMILY_CODE LAST_FAMILY_CODE"""
import io, json, os, sys
sys.path.insert(0, 'src')
from ffl2kster.emu import Emulator

ROM, OUT, F0, F1 = sys.argv[1], sys.argv[2], int(sys.argv[3], 0), int(sys.argv[4], 0)
rom = open(ROM, 'rb').read()
fam = [rom[0x36B70 + i] for i in range(256)]
rep = {}
for i in range(180):
    rep.setdefault(fam[i], i)
st = open('build/states/meat_prompt_slime.state', 'rb').read()
res = json.load(open(OUT)) if os.path.exists(OUT) else {}
with Emulator(ROM) as e:
    pb, m = e.pb, e.pb.memory
    for code in range(F0, F1 + 1):
        if code not in rep:
            continue
        eater = rep[code]
        row = []
        for meat in range(180):
            pb.load_state(io.BytesIO(st))
            m[0xC204] = m[0xC742] = m[0xD00A] = eater; m[0xCF10] = meat
            for _ in range(8):
                pb.button('a', 6); pb.tick(50, False)
                if m[0xC204] != eater:
                    break
            row.append(m[0xC204])
        res[str(code)] = {"eater": eater, "results": row}
        print(f"family {code:02X} (eater {eater}) done", flush=True)
json.dump(res, open(OUT, 'w'))
