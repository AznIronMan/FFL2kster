"""Survey which enemy groups appear near the first town by varying idle frames before pacing.
Enemy group block 0xD500: [alive,total,name x8,ID,type,HP lo,HP hi,s0..s3,...] (probable)."""
import io, sys
from pyboy import PyBoy
sys.path.insert(0, 'tools'); from textdec import dec
rom, state = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 10
pb = PyBoy(rom, window='null', sound_emulated=False); pb.set_emulation_speed(0)
base = open(state, 'rb').read()
hit = []
pb.hook_register(0x0D, 0x44F4, lambda c: hit.append(pb.frame_count), None)
for idle in range(N):
    pb.load_state(io.BytesIO(base)); hit.clear()
    pb.tick(1 + idle * 7, False)
    for i in range(120):
        pre = io.BytesIO(); pb.save_state(pre)
        k = ['up', 'down'][(i // 3) % 2]; pb.button(k, 12); pb.tick(30, False)
        if hit: break
    if not hit: print(idle, 'none'); continue
    pb.tick(240, False)
    blk = bytes(pb.memory[0xD500:0xD520])
    print(f"idle={idle:2d} step={i:3d} groups: alive={blk[0]} total={blk[1]} name={dec(blk[2:10]).strip()!r} id={blk[10]} type={blk[11]} hp={blk[12]|blk[13]<<8} stats={list(blk[14:18])}")
    open(f'build/states/pre_battle_idle{idle}.state', 'wb').write(pre.getvalue())
