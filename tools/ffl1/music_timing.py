"""Legend I music: loop periods measured in PyBoy against the sequence decoder.
For a song that is playing, the frames at which channel 1's sequence pointer (CE02/CE03) reaches
the decoded loop start are recorded over several loops; the measured period is compared with
loop_ticks * 60 / tempo (07:4030 adds the tempo to an accumulator every frame and ticks once per 60).
usage: python tools/ffl1/music_timing.py"""
import sys
sys.path.insert(0, "src")
from ffl1kster import music
from ffl1kster.emu import Emulator

ROM = "ffl1/input/original.gb"


def measure(state, frames=12000, song_override=None):
    rom = open(ROM, "rb").read()
    with Emulator(ROM) as e:
        e.load_state(state)
        m = e.pb.memory
        if song_override is not None:
            m[0xFFE0] = song_override
            e.pb.tick(2, False)
        s = m[0xFFE1]
        d = music.song(rom, s)
        ch = d["channels"][0]
        # after the first event at the loop start has been read the pointer rests just past it
        # (a note waits there for its duration); find the first note at or after the loop start
        k = ch["loop"]
        while ch["events"][k]["op"] != "note":
            k += 1
        target = ch["events"][k]["pc"] + 1
        hits, prev = [], None
        for f in range(frames):
            e.pb.tick(1, False)
            p = m[0xCE02] | m[0xCE03] << 8
            if target is not None and p == target and prev != target:
                hits.append(f)
            prev = p
    periods = [b - a for a, b in zip(hits, hits[1:])]
    pred = ch["loop_ticks"] * 60 / d["tempo"] if d["tempo"] else None
    return s, d["tempo"], ch["loop_ticks"], pred, periods


if __name__ == "__main__":
    for label, st, ov in [("title", "ffl1/build/states/title.state", None),
                          ("first town", "ffl1/build/states/first_town.state", None),
                          ("world", "ffl1/build/states/world.state", None),
                          ("battle", "ffl1/build/states/battle.state", None)]:
        s, tempo, ticks, pred, periods = measure(st, song_override=ov)
        print(f"{label:11s} song {s:2d} tempo {tempo} loop {ticks} ticks -> predicted {pred:.2f} frames; measured {periods}")
