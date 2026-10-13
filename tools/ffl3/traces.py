"""Legend III parity scenarios: record the PyBoy ground-truth traces the port's parity tests replay
(port/packages/ffl3-parity). Output in ffl3/build/traces/NAME (ROM-derived, gitignored).

    python tools/ffl3/traces.py            # all scenarios
    python tools/ffl3/traces.py title1     # some
"""
import sys
sys.path.insert(0, "tools/ffl3")
sys.path.insert(0, "src")
from trace_lib import Recorder, plan_steps  # noqa: E402

TITLE = (1, 0x7C79)   # 01:7C79, the title (called by the start code 00:0200 at 00:023C)
START = (0, 0x0200)   # 00:0200, the start code (power-on: 00:0100 jp 0200)
FIELD = (0, 0x0265)   # 00:0265, the field loop (each iteration)

# name: (state, hook, plan[, state saved at the end])
SCENARIOS = {
    "title1": ("boot", TITLE, "none:400"),
    # the title menu: cursor down/up, B and Start (buzzer), Select, a direction held (key repeat)
    "title2": ("boot", TITLE, "none:60,down:3,none:30,up:3,none:30,b:3,none:40,start:3,none:40,select:3,none:20,"
                              "down:45,none:30,left:3,none:30"),
    # New Game: the prologue text over the world scene (map 0D), then on
    "newgame1": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:1200"),
    # New Game with A held through the prologue text (one frame a tile), its last pause
    # (code 0C), then the name entry screen (0F:7A44) idle
    "newgame2": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:300"),
    # the names: letters, cursor moves both ways (wrapping), B to delete, Start (also empty:
    # buzzer), B on an empty name (back a member); the fade into the opening script
    "newgame3": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:160,"
                                "right:3,none:20,a:3,none:20,down:3,none:20,a:3,none:20,b:3,none:20,left:3,none:20,"
                                "left:3,none:20,right:3,none:20,"
                                "up:3,none:20,up:3,none:20,a:3,none:20,start:3,none:60,"
                                "start:3,none:20,a:3,none:20,start:3,none:60,"
                                "b:3,none:60,a:3,none:20,start:3,none:60,"
                                "a:3,none:10,a:3,none:20,start:3,none:30"),
    # the default names (Start x 4), the opening script's simulator battle (event 1B) up to its
    # command menu, idle
    "battle1": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:160,"
                               "start:3,none:60,start:3,none:60,start:3,none:60,start:3,none:700"),
    # the opening battle's first round: Fight, then A through every member's command and target
    "battle2": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:160,"
                               "start:3,none:60,start:3,none:60,start:3,none:60,start:3,none:200,"
                               + "a:3,none:60," * 12 + "none:900"),
    # the opening battle to its end: A every 40 frames (default commands and targets, every message)
    "battle3": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:160,"
                               "start:3,none:60,start:3,none:60,start:3,none:60,start:3,none:200,"
                               + "a:3,none:37," * 150 + "none:600"),
    # battle3 on through the opening scene after the battle (texts, scripted walks, map animation 1B)
    "opening1": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:160,"
                                "start:3,none:60,start:3,none:60,start:3,none:60,start:3,none:200,"
                                + "a:3,none:37," * 210 + "none:1200"),
    # on through the scene: a map change with the wave fades (CA6B = 1), a screen shake, the next scene
    "opening2": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:160,"
                                "start:3,none:60,start:3,none:60,start:3,none:60,start:3,none:200,"
                                + "a:3,none:37," * 450 + "none:300"),
    # the opening to its end: the last scenes (maps 0A/0B, slides), up to the field loop 00:0265
    # (reached at 29,606; the trace stops before it)
    "opening3": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:160,"
                                "start:3,none:60,start:3,none:60,start:3,none:60,start:3,none:200,"
                                + "a:3,none:37," * 700 + "none:40"),
    # the opening played to the field (the field loop 00:0265 reached at 29,606), 100 frames idle
    # there: saved as field_start.state for the field traces
    "field0": ("boot", TITLE, "none:40,down:3,none:20,a:3,none:100,a:800,none:160,"
                              "start:3,none:60,start:3,none:60,start:3,none:60,start:3,none:200,"
                              + "a:3,none:37," * 705 + "none:100", "field_start"),
    # from field_start (at the field loop 00:0265): idle, A facing nothing
    "field1": ("field_start", FIELD, "none:60," + "a:3,none:37," * 3 + "none:400"),
    # walking in the field: down through the door into the ship, then steps in each direction
    "field2": ("field_start", FIELD, "none:100,down:64,none:20,right:64,none:20,down:64,"
                                     "none:20,left:96,none:20,down:48,none:20,right:120,none:20,up:16,none:120"),
    # the menu (Start, 09:4000): open, the cursor down / up (wrapping), B to close
    "menu1": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,down:3,none:20,up:3,none:20,"
                                    "up:3,none:20,up:3,none:20,b:3,none:60"),
}


def main(names):
    rec = Recorder()
    try:
        for name in names or list(SCENARIOS):
            state, hook, plan, *save = SCENARIOS[name]
            n, w = rec.record(name, state, plan_steps(plan), hook=hook, plan=plan, save=save[0] if save else None)
            print(f"{name}: {n} frames, {w} waits")
    finally:
        rec.close()


if __name__ == "__main__":
    main(sys.argv[1:])
