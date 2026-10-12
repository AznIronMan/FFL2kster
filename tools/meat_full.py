"""Complete empirical meat table: result id for every eater id x meat id 0-179.
Eater set in the battle copy (D00A, plus C204/C742); meat id at CF10; state = meat prompt.
usage: meat_full.py ROM OUT.json EATER_FIRST EATER_LAST   (appends/merges)"""
import io, json, os, sys
sys.path.insert(0, 'src')
from ffl2kster.emu import Emulator
ROM, OUT, A, B = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
st = open('build/states/meat_prompt_slime.state', 'rb').read()
res = json.load(open(OUT)) if os.path.exists(OUT) else {}
with Emulator(ROM) as e:
    pb, m = e.pb, e.pb.memory
    for eater in list(range(A, B + 1)):
        if str(eater) in res:
            continue
        row = []
        for meat in range(180):
            pb.load_state(io.BytesIO(st))
            m[0xC204] = m[0xC742] = m[0xD00A] = eater; m[0xCF10] = meat
            for _ in range(8):
                pb.button('a', 6); pb.tick(50, False)
                if m[0xC204] != eater:
                    break
            row.append(m[0xC204])
        res[str(eater)] = row
        json.dump(res, open(OUT, 'w'))
print('eaters done', len(res))
