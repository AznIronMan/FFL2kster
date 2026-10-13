"""Exploration helper (local): run a button script from a state (or boot), print the screen text
and save a screenshot sheet. python tools/ffl3/explore.py STATE|boot 'a:4/60,down:4/30,...' NAME
Writes ffl3/build/png/NAME.png (one frame per step) and, with SAVE=path, a state at the end."""
import os
import sys

sys.path.insert(0, "src")
from PIL import Image  # noqa: E402

from ffl3kster.emu import Emulator  # noqa: E402

state, script, name = sys.argv[1], sys.argv[2], sys.argv[3]
with Emulator("ffl3/input/original.gb") as emu:
    if state == "boot":
        emu.pb.tick(300, False)
    else:
        emu.load_state(state)
    shots = [emu.screenshot()]
    for i, step in enumerate([s for s in script.split(",") if s]):
        b, rest = step.split(":")
        hold, wait = (int(x) for x in rest.split("/"))
        if b == "none":
            emu.pb.tick(hold + wait, False)
        else:
            emu.press(b, hold, wait)
        if len(shots) < 2 or int(os.environ.get("EVERY", "1")) <= 1 or i % int(os.environ["EVERY"]) == 0:
            shots.append(emu.screenshot())
    for r in emu.screen_text():
        if r.strip(" ·"):
            print("|" + r + "|")
    n = len(shots)
    cols = min(n, 6)
    sheet = Image.new("RGB", (164 * cols, 148 * ((n + cols - 1) // cols)), "gray")
    for i, im in enumerate(shots):
        sheet.paste(im.convert("RGB"), ((i % cols) * 164, (i // cols) * 148))
    os.makedirs("ffl3/build/png", exist_ok=True)
    sheet.save(f"ffl3/build/png/{name}.png")
    if os.environ.get("SAVE"):
        emu.save_state(os.environ["SAVE"])
    print("pc bank", emu.pb.memory[0xC0B1], "frames", emu.pb.frame_count)
