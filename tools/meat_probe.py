"""Find a meat drop with a monster party member and record the transformation.
usage: meat_probe.py ROM EATER_ID [max_battles] [save_prompt_state]"""
import re, io, sys
sys.path.insert(0, 'src')
from ffl2kster.emu import Emulator
from ffl2kster.schema import enemies as E

ROM, EATER = sys.argv[1], int(sys.argv[2])
MAXB = int(sys.argv[3]) if len(sys.argv) > 3 else 30
rom = open(ROM, 'rb').read()


def make_monster(m, slot, mid):
    base = 0xC200 + 32 * slot
    f = {k: E.read_field(rom, mid, k) for k in ('hp', 'str', 'agl', 'mana', 'def', 'type', 'ability_count_minus1', 'ability_ptr')}
    m[base + 4] = mid; m[base + 5] = f['type']; m[base + 6] = 0
    m[base + 7] = f['hp'] & 0xFF; m[base + 8] = f['hp'] >> 8; m[base + 9] = f['hp'] & 0xFF; m[base + 10] = f['hp'] >> 8
    for i, k in enumerate(('str', 'agl', 'mana', 'def')): m[base + 11 + i] = f[k]
    aoff = 0x34000 + f['ability_ptr'] - 0x4000
    for i in range(8):
        if i <= f['ability_count_minus1']:
            a = rom[aoff + i]; m[base + 15 + 2 * i] = a; m[base + 16 + 2 * i] = rom[0x33E80 + a]
        else:
            m[base + 15 + 2 * i] = 0xFF; m[base + 16 + 2 * i] = 0xFF


def heal(m):
    for s in range(5):
        b = 0xC200 + 32 * s
        m[b + 6] = 0; m[b + 7] = m[b + 9]; m[b + 8] = m[b + 10]


def text(e):
    return re.sub(r'\s+', ' ', " ".join(l.strip('|· ') for l in e.screen_text())).strip()


with Emulator(ROM) as e:
    e.load_state('build/states/pre_battle.state'); m = e.pb.memory
    make_monster(m, 0, EATER)
    battles = step = 0; result = None
    while battles < MAXB and step < 6000 and result is None:
        heal(m)
        p0 = e.position()
        e.hook_hits.clear(); e.press(['up', 'down'][(step // 3) % 2]); step += 1
        if not e.hook_hits:
            if e.position() == p0:
                e.press('b', 6, 30); e.press('a', 6, 30)
            continue
        battles += 1; e.pb.tick(240, False)
        enemies = [m[0xD50A + 0x100 * g] for g in range(3)]
        for i in range(600):
            e.pb.button('a', 6); e.pb.tick(26, False)
            t = text(e)
            if 'Eat' in t and 'Cancel' in t:
                mm = re.search(r"Received (\S+?)·s", t)
                meat = mm.group(1) if mm else '?'
                before = m[0xC204]
                if len(sys.argv) > 4:
                    b = io.BytesIO(); e.pb.save_state(b); open(sys.argv[4], 'wb').write(b.getvalue())
                for k in range(30):
                    e.pb.button('a', 6); e.pb.tick(40, False)
                    if m[0xC204] != before: break
                e.pb.tick(200, False)
                result = (meat, before, m[0xC204], enemies, text(e))
                break
            if i % 20 == 19:
                p = e.position(); e.press('down')
                if e.position() != p: break
    print('battles', battles, 'steps', step, 'pos', e.position(), 'result', result)
    print('screen:', text(e)[:200]); e.screenshot().save('build/shots/meat_probe_end.png')
