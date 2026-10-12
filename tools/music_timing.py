"""Verify the decoded sequence timing: request a song (FFB0) and record, per channel, the frame
at which the driver's data pointer (CB04/CB1C/CB34) first returns to the loop target; compare
with music.parse_song length_ticks / (2*tempo/256) frames. Usage: music_timing.py [songs...]"""
import sys
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator
from ffl2kster import music

rom = open("input/original.gb", "rb").read()
songs = [int(x) for x in sys.argv[1:]] or [2, 3, 4]
res = {}
for n in songs:
    s = music.parse_song(rom, n)
    t = music.tempo(s)
    pred = [c["length_ticks"] / (2 * t / 256) for c in s["channels"]]
    with Emulator("input/original.gb") as e:
        e.load_state("build/states/first_town.state"); pb = e.pb
        pb.memory[0xFFB0] = 0; pb.tick(30, False)
        pb.memory[0xFFB0] = n
        start = None; hit = [None] * 3; near = [False] * 3
        for f in range(int(max(pred) * 1.3) + 200):
            pb.tick(1, False)
            ptrs = [pb.memory[a] | pb.memory[a + 1] << 8 for a in (0xCB04, 0xCB1C, 0xCB34)]
            if start is None and pb.memory[0xFFB3] == n:
                start = f
            for c in range(3):
                ch = s["channels"][c]; lt = ch["loop_to"]
                if start is None or hit[c] is not None or not lt:
                    continue
                if ptrs[c] >= ch["loop_at"] - 3:
                    near[c] = True
                elif near[c] and lt <= ptrs[c] < lt + 6:
                    hit[c] = f - start
    res[n] = (pred, hit)
    print(n, "tempo", t, "pred frames", [round(p) for p in pred], "observed", hit, flush=True)
