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
# a battle fought with A every 40 frames (the default commands and targets), shorter
PLAN_BATTLE_SHORT = "none:10," + "a:3,none:37," * 60 + "none:600"

# name: (state, hook, plan[, state saved at the end])
# (POKES: the scenario's pokes at the hook, (address, value[, mask]))
SCENARIOS = {
    # power-on from the start code 00:0200 (the LCD off at line 91, the clears, the vectors) into
    # the title and its music
    "boot1": ("boot", START, "none:400"),
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
    # the ship's cockpit: into the ship, a step up onto the console cell: the console menu (event
    # 23), Depart (the buzzer), the cursor down and up, B out
    "ship1": ("field_start", FIELD, "none:100,down:64,none:60,up:24,none:80,a:3,none:40,down:3,none:20,down:3,none:20,"
                                    "down:3,none:20,down:3,none:20,down:3,none:20,up:3,none:20,up:3,none:20,b:3,none:100"),
    # the cockpit's four items: Engine, Warp, Weapon, Option each chosen (A), their texts, A back;
    # B out
    "ship2": ("field_start", FIELD, "none:100,down:64,none:60,up:24,none:80,down:3,none:20,a:3,none:80,a:3,none:60,"
                                    "down:3,none:20,a:3,none:80,a:3,none:60,down:3,none:20,a:3,none:80,a:3,none:60,"
                                    "down:3,none:20,a:3,none:80,a:3,none:60,b:3,none:100"),
    # up from the ship onto the platform in space, into the spiral: the warp to map 0A, down a step
    "warp1": ("field_start", FIELD, "none:60,up:160,none:30,up:200,none:300,down:60,none:60"),
    # the moving cells up to the platform with each button: back (down: slower, facing down), none,
    # across (left, right: own steps where free), with (up: faster)
    "warp2": ("field_start", FIELD, "none:60,up:96,down:16,none:8,left:6,none:8,right:6,none:200"),
    # through the warp, down map 0A's stairs out onto the world map (map 02) by the temple, steps
    "world1": ("field_start", FIELD, "none:60,up:160,none:30,up:200,none:300,down:200,none:30,down:60,none:30,"
                                     "left:32,none:30,right:64,none:60"),
    # world1 on to the random encounter (00:10C2) and the battle with A held down every 40 frames
    # (the default commands), to the map back (00:1151)
    "enc1": ("field_start", FIELD, "none:60,up:160,none:30,up:200,none:300,down:200,none:30,down:60,none:30,"
                                   "left:32,none:30,right:64,none:60," + "a:3,none:37," * 212 + "b:3,none:60," * 3 + "none:300"),
    # Select in the field (00:0851): the leader rotates through the members (C6F3), its sprite
    # (1.49.1) late-story code reached from field_start by a poked map event (POKES): event 2C, the
    # raster quake (01:5B4D); event 10 F, the ending (06:7F69: the credits, the last screen, its
    # endless loop)
    "quake1": ("field_start", FIELD, "none:600"),
    "ending1": ("field_start", FIELD, "none:200," + ",".join(["a:3,none:57"] * 72)),
    # formation 7D (the last boss's first form; CC5C & 3 = 2) with its HP set to 1 once the battle
    # is up (WAIT_POKES): defeated by the first hit, its end is the transformation (effect 12,
    # 02:50ED)
    "trans1": ("field_start", FIELD, PLAN_BATTLE_SHORT),
    # map event 10 2-1 (00:1508): slot 3 from entry 1523[0] = 6, the record kept aside (0B:6E15:
    # C680 -> C620, its level 07:7BA4, the level values 0F:79D4); then the menu's status page
    "member1": ("field_start", FIELD, "none:60,start:3,none:60,down:3,none:10,down:3,none:10,down:3,none:10,a:3,none:80,b:3,none:40,b:3,none:60"),
    # formation 7D fought to its scripted end: from round 2 the scene state 1 (C9DA, 0C:7E7F) waits
    # for C920 <= D897; D897 poked to FFFF once there, the next round turns C1 into Xagor (0C:7EB3:
    # effect 12, the groups rebuilt with C2, native 0C:6B4F) and the fight goes on with Xagor
    "xagor1": ("field_start", FIELD, "none:10," + "a:3,none:37," * 412 + "none:200"),
    "select1": ("field_start", FIELD, "none:30," + "select:3,none:24," * 5 + "right:16,none:20,left:16,none:40"),
    # Continue on the title (09:4964) with the save menu8 left (slots 1 and 3?): the slot list,
    # the cursor both ways, an empty slot refused, a game loaded (01:7DC5), the saved map (00:025C)
    "cont1": ("boot:menu8", TITLE, "none:40,none:23,a:3,none:80,down:3,none:20,down:3,none:20,up:3,"
                                   "none:20,a:3,none:30,up:3,none:20,a:3,none:300"),
    # the console's Depart (01:63E6) with story flag 05 poked (the console then lets it): the
    # vehicle state by the flags, the map kept at C6E9 loaded; a few steps, B off the vehicle (00:0861)
    "ship3": ("field_start", FIELD, "none:100,down:64,none:60,up:24,none:80,a:3,none:300,down:32,none:30,"
                                    "left:32,none:30,b:3,none:200"),
    # the console's Warp (sub-item 2) with key item E1 poked (C6F9 bit 6): row 0 chosen, confirmed
    # (A): 01:642E with CA50 0 (flags 0E / 0F, the wave flash 0F:7DF2)
    "ship4": ("field_start", FIELD, "none:100,down:64,none:60,up:24,none:80,down:3,none:20,down:3,none:20,"
                                    "a:3,none:80,a:3,none:60,a:3,none:400"),
    # items used in the field (09:4BC8, 09:521A) with a bag poked: E6 (0F:7BC8), Cure1 on a member,
    # HP (a stat), Elixir, Tent, Soft (no field effect: the buzzer), then B out
    "menu10": ("field_start", FIELD, "none:30,start:3,none:60,a:3,none:60,a:3,none:30,a:3,none:200,"
                                     + "down:3,none:20,a:3,none:30,a:3,none:60,a:3,none:120," * 5
                                     + "b:3,none:40,b:3,none:40,b:3,none:60"),
    # the field spell Exit (1B, 09:4D87 / 01:422E) poked into the leader's spell bits: the spell
    # list, Exit cast (the warp back 01:41D6 after the menu, or refused)
    "menu11": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40,a:3,none:60,a:3,none:30,"
                                     "a:3,none:60,a:3,none:400"),
    # the same on map 42 (state m42, the map sweep's; CA6C clear): Exit cast, the warp back after
    # the menu (01:41D6: the closing band 01:5F39, the map load with the fade in 01:5F9D)
    "menu12": ("m42", FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40,a:3,none:60,a:3,none:30,"
                             "a:3,none:60,a:3,none:400"),
    # the field spells 20 / 21 / 25 (each poked alone) cast on the world map (state m02): after the
    # menu 01:40DD / 01:4049 / 01:4233
    "menu13": ("m02", FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40,a:3,none:60,a:3,none:30,a:3,none:60,a:3,none:400"),
    "menu14": ("m02", FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40,a:3,none:60,a:3,none:30,a:3,none:60,a:3,none:400"),
    "menu15": ("m02", FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40,a:3,none:60,a:3,none:30,a:3,none:60,a:3,none:400"),
    # the menu (Start, 09:4000): open, the cursor down / up (wrapping), B to close
    "menu1": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,down:3,none:20,up:3,none:20,"
                                    "up:3,none:20,up:3,none:20,b:3,none:60"),
    # menu item 0 (the items, 09:4350): the list, the cursor, an item picked and put back, B out
    "menu2": ("field_start", FIELD, "none:30,start:3,none:60,a:3,none:60,down:3,none:20,down:3,none:20,up:3,none:20,"
                                    "right:3,none:20,left:3,none:20,a:3,none:30,b:3,none:30,b:3,none:40,b:3,none:60"),
    # menu item 1 (the abilities, 09:435E): a member chosen, the list, B back twice, B out
    "menu3": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40,a:3,none:60,down:3,none:20,"
                                    "b:3,none:40,down:3,none:20,a:3,none:60,b:3,none:40,b:3,none:40,b:3,none:60"),
    # menu item 2 (09:4A4A, a member's 8 bytes C548-C54F): a member chosen, the rows and columns moved (both
    # ends: the buzzer), B back, B out
    "menu4": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,down:3,none:20,a:3,none:40,a:3,none:60,up:3,none:20,down:3,none:20,down:3,none:20,"
                                    "down:3,none:20,down:3,none:20,right:3,none:20,up:3,none:20,left:3,none:20,b:3,none:40,down:3,none:20,a:3,none:60,"
                                    "b:3,none:40,b:3,none:40,b:3,none:60"),
    # menu item 3 (09:4377, the status): two members' status boxes, B out
    "menu5": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,down:3,none:20,down:3,none:20,a:3,none:40,a:3,none:80,a:3,none:40,down:3,none:20,"
                                    "a:3,none:80,b:3,none:40,b:3,none:40,b:3,none:60"),
    # menu item 4 (09:439F, the equipment): a member, the weapon slot, the bag list scrolled, the weapon taken off;
    # the helm slot (refused), the weapon put on again, a refused swap, B out
    "menu6": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,a:3,none:40,a:3,none:60,a:3,none:60,down:3,none:20,"
                                    "down:3,none:20,up:3,none:20,a:3,none:80,a:3,none:80,a:3,none:60,down:3,none:20,a:3,none:80,"
                                    "down:3,none:20,a:3,none:80,a:3,none:60,b:3,none:40,b:3,none:40,b:3,none:40,b:3,none:60"),
    # menu item 5 (09:43B1, the auto-battle marks): two members toggled, one twice, B out
    "menu7": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,a:3,none:40,a:3,none:40,down:3,none:20,a:3,none:40,"
                                    "a:3,none:40,b:3,none:40,b:3,none:60"),
    # menu item 6 (09:43F0, the save): the slots, down, B back; again: A on an empty slot, saved; again: A on
    # the used slot, asked: B (no), A again, asked: A (yes), saved
    "menu8": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,a:3,none:80,down:3,none:20,up:3,none:20,b:3,none:80,"
                                    "a:3,none:80,down:3,none:20,a:3,none:100,a:3,none:80,down:3,none:20,a:3,none:60,"
                                    "b:3,none:60,a:3,none:60,a:3,none:120,b:3,none:60"),
    # menu item 6 again: a slot saved, the save screen entered again and left by B; the menu's rows
    # are shown (hblank-paced copies) while a 16th frame redraws the walking figures (CD3C)
    "menu9": ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,down:3,none:20,a:3,none:80,down:3,none:20,up:3,none:20,b:3,none:80,"
                                    "a:3,none:80,down:3,none:20,a:3,none:60,a:3,none:120,b:3,none:60"),
}


# ---------------------------------------------------------------- the map sweep
#
# Every map entered from field_start through event 04 (00:14AA -> 01:6578, the return point popped
# from the RAM stack C7A0 / C7B0 / C7C0 at level C7C8 - 2) poked at the field loop: level 2, the
# map, the cell (moved back one cell against the facing, which 01:6578 steps forward), masks FF
# (00:027D sets CA04 / CA05 again), the leader's cell attribute C2F0 = C4 and CA56 = 1 (a step
# was made: 00:08F3 runs the cell's event). The entry cell is the destination of the first exit
# (06:6308) or door (06:6BA4) into the map (ffl3/data/maps.json, local); maps nothing leads to
# (map_entries()[1]) are left for the event sweep.

PLAN_MAP = "none:200,down:16,none:30,up:16,none:30,left:16,none:30,right:16,none:60"


def _door_cell(b):
    """A door's packed coordinate: low nibble + bits 4-6 x 16 (the cell), bit 7 a facing bit."""
    return ((b >> 4) & 7) * 16 + (b & 0x0F), b >> 7


def map_entries():
    import json
    d = json.load(open("ffl3/data/maps.json"))["tables"]
    dest = {}
    for src, lst in sorted(d["map"]["warps"].items()):
        for e in lst:
            b = bytes.fromhex(e)
            dest.setdefault(b[1], (b[2], b[3]))
    for r in d["door"]["records"]:
        f = r["fields"]
        dest.setdefault(f["map"], (f["x"], f["y"]))
    return {mp: dest[mp] for mp in sorted(dest)}, [r["id"] for r in d["map"]["records"] if r["id"] not in dest]


def map_pokes(mp, b1, b2):
    y, fy = _door_cell(b1)    # byte 1 -> C6E4/C6E5 (y), byte 2 -> C6E6/C6E7 (x) (00:1481-149E)
    x, fx = _door_cell(b2)
    face = (fx << 7) | (fy << 6)          # 00:1471-147E
    dy, dx = {0x00: (-1, 0), 0x40: (0, 1), 0x80: (1, 0), 0xC0: (0, -1)}[face]
    return ((0xC7C8, 2), (0xC7A0, (y - dy) & 0xFF), (0xC7A1, (x - dx) & 0xFF), (0xC7B0, 0xFF), (0xC7B1, 0xFF),
            (0xC7C0, mp), (0xC6EE, face), (0xC2F0, 0xC4), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0))


# name: ((wait n, pokes), ...): applied as frame wait n ends (Recorder.record's wait_pokes)
WAIT_POKES = {
    "trans1": ((190, ((0xD290, 0x01), (0xD291, 0x00))),),   # the boss's current HP (entity D280 + 10) = 1
    "xagor1": ((("frame", 8000), ((0xD897, 0xFF), (0xD898, 0xFF))),),   # D897 (the scene's threshold) = FFFF
}

POKES = {
    "member1": ((0xC2F0, 0xD0), (0xCA28, 0x21), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)),   # map event 10, 2-1
    "xagor1": ((0xC2F0, 0xDB), (0xCA28, 0x7D), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)),   # formation 7D
    "trans1": ((0xC2F0, 0xDB), (0xCA28, 0x7D), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)),   # map event 1B, formation 7D
    "quake1": ((0xC2F0, 0xEC), (0xCA28, 0x00), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)),   # map event 2C
    "ending1": ((0xC2F0, 0xD0), (0xCA28, 0xF0), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)),  # map event 10, F
    "ship3": ((0xC760, 0x04, 0x04),),   # story flag 05
    "ship4": ((0xC6F9, 0x40, 0x40),),   # key item E1
    "menu10": ((0xC701, 0xC0), (0xC702, 0x03), (0xC703, 0xCD), (0xC704, 0x01), (0xC705, 0xCA), (0xC706, 0x01),
               (0xC707, 0xCB), (0xC708, 0x01), (0xC709, 0xC5), (0xC70A, 0x01)),   # Cure1 x3, HP, Elixir, Tent, Soft
    "menu11": ((0xC553, 0x08),),   # the leader's spell Exit (1B)
    "menu12": ((0xC553, 0x08),),
    "menu13": ((0xC556, 0x01),),   # 20
    "menu14": ((0xC556, 0x02),),   # 21
    "menu15": ((0xC556, 0x20),),   # 25
}

def map_sweep():
    entries, _ = map_entries()
    return {f"map{mp:02x}": ("field_start", FIELD, PLAN_MAP, map_pokes(mp, *b), f"m{mp:02x}") for mp, b in entries.items()}


# ---------------------------------------------------------------- the talk sweep
#
# From each map's end state (m.., saved by the map sweep), every object found there
# (ffl3/build/talk_targets.json, tools/ffl3/talk_targets.py) is poked onto the cell the leader
# faces (its position C210 / C230 and target C290 / C2B0, 16-bit) at the field loop, then A and
# the texts pressed through (A, then B), whatever the object starts (words, signs, items, shops,
# battles, scenes).

PLAN_TALK = "none:20,a:3,none:80," + "a:3,none:50," * 12 + "b:3,none:50," * 4 + "none:120"


def talk_sweep():
    import json
    import os
    if not os.path.exists("ffl3/build/talk_targets.json"):
        return {}
    out = {}
    for t in json.load(open("ffl3/build/talk_targets.json")):
        mp, s, y, x = t["map"], t["slot"], t["y"], t["x"]
        pokes = ((0xC210 + 2 * s, y & 0xFF), (0xC211 + 2 * s, y >> 8), (0xC230 + 2 * s, x & 0xFF), (0xC231 + 2 * s, x >> 8),
                 (0xC290 + 2 * s, y & 0xFF), (0xC291 + 2 * s, y >> 8), (0xC2B0 + 2 * s, x & 0xFF), (0xC2B1 + 2 * s, x >> 8))
        st = t.get("state", f"m{mp:02x}")
        out[f"t{st[1:]}_{s:x}"] = (st, FIELD, PLAN_TALK, pokes)
    return out


# ---------------------------------------------------------------- the battle sweep
#
# From field_start, a pending map event 1B (C2F0 = DB with a step made, CA56) starts the battle
# with formation CA28 (00:19D0; FFCA = CA28 + 80), for every formation 00-7D but 42 (C2: the
# scripted loss that resets); then A every 40 frames (the default commands and targets), B for the
# questions after it, the map back. Named bXX.

PLAN_BATTLE = "none:10," + "a:3,none:37," * 120 + "b:3,none:40," * 4 + "none:200"


def battle_sweep():
    return {f"b{k:02x}": ("field_start", FIELD, PLAN_BATTLE, ((0xC2F0, 0xDB), (0xCA28, k), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)))
            for k in range(0x7E) if k != 0x42}
# (7E, Xagor alone, is never a battle's start: its picture sheet 19 begins with FF, so 00:3D76's
# block size is 0 and the original never comes back from 0B:40BF; no zone or script names it.
# Xagor appears through the transformation of 7D's C1, effect 12 / 0E:7D63: trace trans1.)



# ---------------------------------------------------------------- the input sweep
#
# Seeded random single-button input (plan text in trace.json; same plan on both sides) from
# field_start with a rich party poked at the hook: every spell (C551-C556 + 0x60 k = FF), MP
# 999/999 (+14 / +16), the bag (C6FF, 24 pairs) filled with 24 item kinds (9 each) chosen by the
# seed. zbNN: a battle first (map event 1B, formation by the seed), then the field; zfNN: the
# field (walking, the menus, Select). Reaches the menus, lists, targets and effects the
# A-every-40-frames sweeps never choose.

FUZZ_BATTLE_KEYS = (("a", 7), ("b", 2), ("up", 2), ("down", 3), ("left", 1), ("right", 2))
FUZZ_FIELD_KEYS = (("a", 5), ("b", 2), ("up", 3), ("down", 3), ("left", 3), ("right", 3), ("start", 2), ("select", 1))


def fuzz_plan(seed, n, keys):
    import random
    r = random.Random(seed)
    names, weights = [k for k, _ in keys], [w for _, w in keys]
    out = ["none:10"]
    for _ in range(n):
        k = r.choices(names, weights)[0]
        hold = 3 if k in ("a", "b", "start", "select") or r.random() < 0.6 else r.randint(8, 24)
        out += [f"{k}:{hold}", f"none:{r.randint(10, 40)}"]
    out.append("none:200")
    return ",".join(out)


FUZZ_ITEMS = [i for i in range(0x30, 0xFF)]


def rich_party(seed):
    p = []
    for k in range(5):
        b = 0xC500 + 0x60 * k
        p += [(b + 0x14, 0xE7), (b + 0x15, 0x03), (b + 0x16, 0xE7), (b + 0x17, 0x03)]
        p += [(b + 0x51 + i, 0xFF) for i in range(6)]
    start = (24 * seed) % len(FUZZ_ITEMS)
    for i in range(24):
        p += [(0xC6FF + 2 * i, FUZZ_ITEMS[(start + i) % len(FUZZ_ITEMS)]), (0xC700 + 2 * i, 9)]
    return tuple(p)


FUZZ_FORMATIONS = [k for k in range(0x7E) if k != 0x42]
FUZZ_SHOP_KEYS = (("a", 5), ("b", 2), ("up", 2), ("down", 3), ("left", 1), ("right", 2))
# shop kinds (CA2F = CA28 - 1): shops with the forge (00-1F | 80) or the mix (20-3F | 80), plain
# shops, clinics (40-4F), services (50-57)
FUZZ_SHOPS = ([0x80 | k for k in range(0, 0x20, 2)] + [0x80 | k for k in range(0x20, 0x40, 2)]
              + list(range(1, 0x40, 4)) + list(range(0x40, 0x50, 2)) + list(range(0x50, 0x58)))


def shop_party(seed):
    p = list(rich_party(seed))
    for i, iid in enumerate((0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7)):
        p += [(0xC6FF + 2 * i, iid), (0xC700 + 2 * i, 9)]
    gp = 999990 if seed % 2 else 120
    p += [(0xC6E0, gp & 0xFF), (0xC6E1, (gp >> 8) & 0xFF), (0xC6E2, gp >> 16)]
    for k in range(5):   # some damage for the clinics
        b = 0xC500 + 0x60 * k
        p += [(b + 0x10, 0x05), (b + 0x11, 0x00), (b + 0x14, 0x02), (b + 0x15, 0x00)]
    return tuple(p)


def fuzz_sweep(nb=72, nf=36):
    out = {}
    for j in range(nb):
        k = FUZZ_FORMATIONS[(j * 37) % len(FUZZ_FORMATIONS)]
        out[f"zb{j:02d}"] = ("field_start", FIELD, fuzz_plan(1000 + j, 160, FUZZ_BATTLE_KEYS),
                             rich_party(j) + ((0xC2F0, 0xDB), (0xCA28, k), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)))
    for j in range(nf):
        out[f"zf{j:02d}"] = ("field_start", FIELD, fuzz_plan(2000 + j, 160, FUZZ_FIELD_KEYS), rich_party(j + 3))
    for j, kind in enumerate(FUZZ_SHOPS):
        out[f"zs{j:02d}"] = ("field_start", FIELD, fuzz_plan(3000 + j, 120, FUZZ_SHOP_KEYS),
                             shop_party(j) + ((0xC2F0, 0xD7), (0xCA28, (kind + 1) & 0xFF), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)))
    # the third option (zrNN: the shops with the forge, CA2F 00-1E | 80, and the mix, 20-3E | 80):
    # Right twice to it (01:7077), A, then input weighted to A and the rows (the forge 01:7359,
    # the mix 01:7470 with the bag's D2-D7)
    for j, kind in enumerate(FUZZ_SHOPS[:32]):
        out[f"zr{j:02d}"] = ("field_start", FIELD, "none:120,right:3,none:20,right:3,none:20,a:3,none:60," + fuzz_plan(3500 + j, 100, FUZZ_THIRD_KEYS),
                             shop_party(j) + ((0xC2F0, 0xD7), (0xCA28, (kind + 1) & 0xFF), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)))
    # the spell sweep (zmNN): one spell known by every member (C551 + bit), MP 999, a battle with
    # input weighted to A, down and right; the item sweep (ziNN): a bag of 6 item kinds (4 each);
    # the effects (02:4xxx animations, 0B targets) the zb sweep reaches rarely
    battle = ((0xC2F0, 0xDB), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0))
    for j in range(48):
        p = list(rich_party(j))
        for k in range(5):
            b = 0xC500 + 0x60 * k
            p += [(b + 0x51 + i, (1 << (j % 8)) if i == j // 8 else 0) for i in range(6)]
        k = FUZZ_FORMATIONS[(j * 11) % len(FUZZ_FORMATIONS)]
        out[f"zm{j:02d}"] = ("field_start", FIELD, fuzz_plan(4000 + j, 200, FUZZ_SPELL_KEYS), tuple(p) + battle + ((0xCA28, k),))
    for j in range((len(FUZZ_ITEMS) + 5) // 6):
        p = list(rich_party(j))
        kinds = [FUZZ_ITEMS[(6 * j + i) % len(FUZZ_ITEMS)] for i in range(6)]
        for i in range(24):
            p += [(0xC6FF + 2 * i, kinds[i % 6]), (0xC700 + 2 * i, 9)]
        k = FUZZ_FORMATIONS[(j * 13 + 5) % len(FUZZ_FORMATIONS)]
        out[f"zi{j:02d}"] = ("field_start", FIELD, fuzz_plan(4500 + j, 200, FUZZ_SPELL_KEYS), tuple(p) + battle + ((0xCA28, k),))
    # the event sweep (zeTTP): a map event of type TT (C2F0 = C0 | TT, a step made) with
    # parameter CA28 from EVENT_PARAMS[P], from field_start, then A every 40 frames and B: the
    # event types the story traces reach rarely (falls, screens, specials, items, scenes, patches,
    # the party's rest and revival, the menu, rocks, objects, walks, morphs, switches)
    for t in EVENT_TYPES:
        for i, prm in enumerate(EVENT_PARAMS_OF.get(t, EVENT_PARAMS)):
            out[f"ze{t:02x}{'0123456789abcdefghij'[i]}"] = ("field_start", FIELD, PLAN_EVENT,
                                    rich_party(t + i) + ((0xC2F0, 0xC0 | t), (0xCA28, prm), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0)))
    # the field uses (zuII: a bag of item II, 24 x 9; zvNN: every member knows spell NN only, MP
    # 999), the party hurt (HP 5, MP 2 for zu), from the field menu's Items (zu) or Abilities (zv)
    # with input weighted to A: the field effects of items and spells (09:52E4..), key items
    for iid in range(0xC0, 0x100):
        p = list(rich_party(0))
        p += [(0xC6FF + 2 * i, iid) for i in range(24)] + [(0xC700 + 2 * i, 9) for i in range(24)]
        for k in range(5):
            b = 0xC500 + 0x60 * k
            p += [(b + 0x10, 0x05), (b + 0x11, 0x00), (b + 0x14, 0x02), (b + 0x15, 0x00)]
        out[f"zu{iid:02x}"] = ("field_start", FIELD, "none:30,start:3,none:60,a:3,none:60," + fuzz_plan(5000 + iid, 100, FUZZ_USE_KEYS), tuple(p))
    # the spell books (zu00..zu2F: a bag of book II; the members know no spell, C551-C556 = 0):
    # 09:4C4C, the spell learned by the member chosen (or known, or 24 known: the messages); the
    # list scrolled both ways (up weighted)
    for iid in range(0x00, 0x30):
        p = list(rich_party(0))
        p += [(0xC6FF + 2 * i, iid) for i in range(24)] + [(0xC700 + 2 * i, 9) for i in range(24)]
        for k in range(5):
            p += [(0xC500 + 0x60 * k + 0x51 + i, 0x00) for i in range(6)]
        out[f"zu{iid:02x}"] = ("field_start", FIELD, "none:30,start:3,none:60,a:3,none:60," + fuzz_plan(5100 + iid, 100, FUZZ_BOOK_KEYS), tuple(p))
    for j in range(48):
        p = list(rich_party(j))
        for k in range(5):
            b = 0xC500 + 0x60 * k
            p += [(b + 0x51 + i, (1 << (j % 8)) if i == j // 8 else 0) for i in range(6)]
            p += [(b + 0x10, 0x05), (b + 0x11, 0x00)]
        out[f"zv{j:02d}"] = ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40," + fuzz_plan(5500 + j, 100, FUZZ_USE_KEYS), tuple(p))
    # the lists scrolled (ztNN: the rich party's full bag in Items, 0-3, and every spell known in
    # Abilities, 4-5; Down past the page, then Up past its top: 09:4812 / 09:47E2, then the keys)
    for j in range(6):
        head = "none:30,start:3,none:60," + ("a:3,none:60," if j < 4 else "down:3,none:20,a:3,none:40,a:3,none:40,")
        out[f"zt{j:02d}"] = ("field_start", FIELD, head + "down:3,none:12," * 12 + "up:3,none:12," * 14 + fuzz_plan(5900 + j, 60, FUZZ_LIST_KEYS), rich_party(j))
    # a spell back to the bag with nine of its book there (zdNN: the field spells as zv, bag slot 0
    # nine of the book of the spell known, id 8 (J >> 3 ^ 1) + J & 7, the bit's byte C551 + (id >> 3
    # ^ 1)): the question 09:6FAE (0B:6DB3, 09:4921), A gives the spell up, B keeps it
    for j in range(24):
        p = list(rich_party(j)) + [(0xC6FF, 8 * ((j >> 3) ^ 1) + (j & 7)), (0xC700, 9)]
        for k in range(5):
            b = 0xC500 + 0x60 * k
            p += [(b + 0x51 + i, (1 << (j % 8)) if i == j // 8 else 0) for i in range(6)]
            p += [(b + 0x10, 0x05), (b + 0x11, 0x00)]
        out[f"zd{j:02d}"] = ("field_start", FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40," + fuzz_plan(5800 + j, 100, FUZZ_USE_KEYS), tuple(p))
    # the command sweep (zcNN): battles with Start in the input, which turns a member's command
    # page (0B:6095): page 2's Defend (0B:64B4) and Cover (0B:64BE), undone by B (0B:5E93)
    for j in range(24):
        k = FUZZ_FORMATIONS[(j * 29 + 3) % len(FUZZ_FORMATIONS)]
        out[f"zc{j:02d}"] = ("field_start", FIELD, fuzz_plan(6000 + j, 160, FUZZ_COMMAND_KEYS), rich_party(j) + battle + ((0xCA28, k),))
    # the console sweep (zkNN): the ship's console (event 23, as ship1) with key item bit NN % 16
    # (C6F8 bits 0-7, C6F9 bits 0-7) and story flags by NN // 16 (none; 05; 0E; 05, 0E and 56),
    # input weighted to A and down: the items confirmed (01:642E: the stages, the wave flash, the
    # lift-off 01:647B), Depart (01:63E6)
    for j in range(64):
        bit, fl = j % 16, j // 16
        p = list(rich_party(j)) + [(0xC6F8 + bit // 8, 1 << (bit % 8), 1 << (bit % 8))]   # (address, value, mask)
        p += [((0xC760, 0x04, 0x04),), ((0xC761, 0x02, 0x02),), ((0xC760, 0x04, 0x04), (0xC761, 0x02, 0x02), (0xC76A, 0x02, 0x02))][fl - 1] if fl else []
        out[f"zk{j:02d}"] = ("field_start", FIELD, "none:100,down:64,none:60,up:24,none:80," + fuzz_plan(7000 + j, 60, FUZZ_CONSOLE_KEYS), tuple(p))
    # the console's items chosen (znIRF): every key item (C6F8 / C6F9 = FF), console item I (0-3:
    # Engine, Warp, Weapon, Option), sub-menu row R (0-2) confirmed with A, story flags F (0: as
    # field_start; 1: 0E set; 2: 56 set): 01:642E's stages (flags 0E / 0F), the wave flash and the
    # lift-off (CA50 2: 01:647B)
    for i in range(4):
        for r in range(3):
            for fl in range(3):
                p = list(rich_party(i)) + [(0xC6F8, 0xFF), (0xC6F9, 0xFF)] + [[], [(0xC761, 0x02, 0x02)], [(0xC76A, 0x02, 0x02)]][fl]
                out[f"zn{i}{r}{fl}"] = ("field_start", FIELD, "none:100,down:64,none:60,up:24,none:80," + "down:3,none:20," * i + "a:3,none:80,"
                                         + "down:3,none:20," * r + "a:3,none:60,a:3,none:600,a:3,none:200,b:3,none:100", tuple(p))
    # the target sweep (zgNN): battles with input weighted to the directions (the target moved
    # over the members, the enemies, past the edges to a group or all, 0B:698D) and A
    for j in range(24):
        k = FUZZ_FORMATIONS[(j * 23 + 11) % len(FUZZ_FORMATIONS)]
        out[f"zg{j:02d}"] = ("field_start", FIELD, fuzz_plan(6500 + j, 200, FUZZ_TARGET_KEYS), rich_party(j + 7) + battle + ((0xCA28, k),))
    out.update(save_sweep())
    out.update(continue_sweep())
    return out


FUZZ_TARGET_KEYS = (("a", 5), ("b", 1), ("up", 3), ("down", 3), ("left", 3), ("right", 3))


def continue_sweep():
    """Continue on the title with a player's save (zoNN: .private/saves/sNN.sav, local only): the
    slot list, A on the first slot (the valid one), the game loaded (09:4E0C, cont.ts: the
    leader, followers, the vehicle, the status scene), then a short walk."""
    import glob
    out = {}
    for path in sorted(glob.glob(".private/saves/s[0-9][0-9].sav")):
        n = path.split("/")[-1][1:3]
        out[f"zo{n}"] = (f"boot:s{n}.sav", TITLE, "none:40,none:23,a:3,none:80,a:3,none:30,a:3,none:400,"
                                                  + fuzz_plan(9000 + int(n), 40, FUZZ_FIELD_KEYS), ())
    return out


def save_sweep():
    """The save starts (zyTKNN): each field state made from a player's battery save
    (tools/ffl3/sav.py state FILE SLOT svT -> ffl3/build/states/field_svT.state, local only), with
    the party as saved: K = b, battles with the zb keys and Start (formation by NN); l, battles
    with every member at HP 1, the enemies' HP 9999 and A every 40 frames (the party falls: the
    "continue" question, answered Yes);
    f, the field with the zf keys."""
    import glob
    out = {}
    battle = ((0xC2F0, 0xDB), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0))
    for path in sorted(glob.glob("ffl3/build/states/field_sv*.state")):
        t = path.split("field_sv")[1][:-6]
        if len(t) != 1:
            continue
        st = f"field_sv{t}"
        for j in range(12):
            k = FUZZ_FORMATIONS[(j * 31 + 7) % len(FUZZ_FORMATIONS)]
            out[f"zy{t}b{j:02d}"] = (st, FIELD, fuzz_plan(8000 + j, 160, FUZZ_COMMAND_KEYS), battle + ((0xCA28, k),))
        # (the enemies' HP 9999 from the first frame wait after frame 900, the battle set up, on an
        # encounter zone CA2D = 01: the party falls, the loss counted)
        for j, k in enumerate((0x25, 0x6F, 0x5E, 0x10)):
            hp1 = tuple((0xC500 + 0x60 * i + o, v) for i in range(5) for o, v in ((0x10, 1), (0x11, 0)))
            out[f"zy{t}l{j:02d}"] = (st, FIELD, "none:10," + "a:3,none:37," * 220 + "none:200", hp1 + battle + ((0xCA28, k), (0xCA2D, 0x01)),
                                     None, ((("frame", 900), TANK_ENEMIES),))
        for j in range(8):
            out[f"zy{t}f{j:02d}"] = (st, FIELD, fuzz_plan(8500 + j, 160, FUZZ_FIELD_KEYS), ())
        # the field spells cast where the save stands (zyTsNN: every member knows spell N of 21 20
        # 25 1B 2C only (C551 + (id >> 3 ^ 1), bit id & 7), MP 999; Start, Down, A to the spells,
        # then the zu keys): 01:40D6 / 01:4132 after the menu (the step ahead, the warp back)
        for j, sid in enumerate(FIELD_SPELLS):
            p = []
            for i in range(5):
                b = 0xC500 + 0x60 * i
                p += [(b + 0x14, 0xE7), (b + 0x15, 0x03), (b + 0x16, 0xE7), (b + 0x17, 0x03)]
                p += [(b + 0x51 + k, (1 << (sid & 7)) if k == (sid >> 3) ^ 1 else 0) for k in range(6)]
            out[f"zy{t}s{j:02d}"] = (st, FIELD, "none:30,start:3,none:60,down:3,none:20,a:3,none:40," + fuzz_plan(8700 + j, 100, FUZZ_USE_KEYS), tuple(p))
        # the field with B weighted (zyTjNN): the jumps on foot (01:47B2, maps 0C and on): a hop, one
        # or two cells, refused (01:48FF), pushable objects (01:46C5)
        for j in range(4):
            out[f"zy{t}j{j:02d}"] = (st, FIELD, fuzz_plan(8800 + j, 160, FUZZ_JUMP_KEYS), ())
    return out


FUZZ_CONSOLE_KEYS = (("a", 6), ("b", 1), ("up", 2), ("down", 3))
FUZZ_COMMAND_KEYS = (("a", 6), ("b", 2), ("up", 2), ("down", 3), ("left", 1), ("right", 2), ("start", 2))


FUZZ_USE_KEYS = (("a", 6), ("b", 1), ("up", 1), ("down", 2), ("right", 1))
FUZZ_LIST_KEYS = (("up", 3), ("down", 3), ("a", 2), ("b", 1))
FUZZ_JUMP_KEYS = (("b", 4), ("up", 3), ("down", 3), ("left", 3), ("right", 3), ("a", 1))
FIELD_SPELLS = (0x21, 0x20, 0x25, 0x1B, 0x2C)
FUZZ_THIRD_KEYS = (("a", 5), ("b", 1), ("up", 2), ("down", 2))
FUZZ_BOOK_KEYS = (("a", 6), ("b", 1), ("up", 3), ("down", 3), ("right", 1))

EVENT_TYPES = (0x08, 0x09, 0x10, 0x11, 0x12, 0x13, 0x16, 0x18, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23,
               0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x2B)
EVENT_PARAMS = (0x00, 0x01, 0x02, 0x03, 0x05, 0x12, 0x21, 0x47)
# event 11 has 6 entries (00:196C), event 12 18 (00:16BC): no parameter past them
# event 10 (the party, 00:14C0 by CA28 >> 4): past the first eight, the flags by the facing (6),
# the map's objects again (7), a member's status scene (8), a return stack (A), back to C6E9 (B,
# E), off the vehicle (C), the place kept (D)
EVENT_PARAMS_OF = {0x11: tuple(range(6)), 0x12: tuple(range(0x12)),
                   0x10: EVENT_PARAMS + (0x61, 0x71, 0x81, 0x82, 0x83, 0xA1, 0xA2, 0xB1, 0xC1, 0xD1, 0xE1, 0x31),
                   # event 16: texts CD / D0 of 0A:4004, the ships' "Get on!" with code 3C (yes / no)
                   0x16: EVENT_PARAMS + (0xCD, 0xD0),
                   # event 1E: the other scene effects (spawns 19-1C, the flashes 1D, the tiles fade 24)
                   0x1E: EVENT_PARAMS + (0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x24)}
PLAN_EVENT = "none:10," + "a:3,none:37," * 40 + "b:3,none:40," * 3 + "none:200"

FUZZ_SPELL_KEYS = (("a", 7), ("b", 1), ("up", 1), ("down", 3), ("left", 1), ("right", 3))

# The enemy abilities (zxKK: formation KK): the battle effects 03-0D (02:4397) come from the action
# display C9BD of the enemies' battle abilities (09:5466 table 2: monster_ability slots with their
# mask bit), which the enemies choose rarely (about 1 action in 100) and the parties win first.
# From field_start (the rich party), A every GAP frames; at the first frame wait from frame 600
# every entity's HP (D000-D600, +10..+13) is 9999, so the battle goes on; the formation and GAP
# were found by a scan of every formation (local, ffl3/scratch/effscan2.py): 25 / 43 reaches the
# effects 6 and 3, 1E / 37 the effects 7, 9 and A, 54 / 46 the effect C.
ENEMY_ABILITIES = {0x25: (43, 8000), 0x1E: (37, 27000), 0x54: (46, 9500)}
TANK = tuple(p for b in range(0xD000, 0xD680, 0x80) for p in ((b + 0x10, 0x0F), (b + 0x11, 0x27), (b + 0x12, 0x0F), (b + 0x13, 0x27)))
# The members' weapons (zw00): a member's Fight shows the action display of its weapon (table 0
# of 09:5466 by the item id, C99D): the weapons 6E (effect D), 6F (4), 70 (4, B) in the members'
# first two slots (+40 / +41: member j has W[j], W[j + 1]), formation 0, HP 9999 from frame 600,
# A every 40 frames (a scan of every item id: ffl3/scratch/wscan.py; ids outside the weapons,
# which the equipment menu never puts there, reach effects past the table, e.g. armor BE: 18).
MEMBER_WEAPONS = {"zw00": ((0x6E, 0x6F, 0x70, 0x6E, 0x70), 8000)}
for _n, (_w, _len) in MEMBER_WEAPONS.items():
    SCENARIOS[_n] = ("field_start", FIELD, "none:10," + "a:3,none:37," * (_len // 40) + "none:10")
    POKES[_n] = rich_party(0) + tuple((0xC500 + 0x60 * j + 0x40 + i, _w[(j + i) % 5]) for j in range(5) for i in range(2)) \
        + ((0xC2F0, 0xDB), (0xCA28, 0x00), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0))
    WAIT_POKES[_n] = ((("frame", 600), TANK),)
# The lost battles (zlNN): the party of field_start with every member at HP 1 against formation
# LOST_FORMATIONS[NN] on an encounter zone (CA2D = 01: a battle lost where the map's zone is 0 is
# not counted, 0C:4B6A), the enemies' HP 9999 from the first frame wait after frame 600, A every
# 40 frames: the party falls, CEDA = FF, the "continue" question (0F:7F8F) answered Yes (the map
# state back from DD00, 0F:7DC9).
LOST_FORMATIONS = (0x25, 0x6F, 0x5E, 0x10)
TANK_ENEMIES = tuple(p for b in range(0xD280, 0xD680, 0x80) for p in ((b + 0x10, 0x0F), (b + 0x11, 0x27), (b + 0x12, 0x0F), (b + 0x13, 0x27)))
for _j, _k in enumerate(LOST_FORMATIONS):
    SCENARIOS[f"zl{_j:02d}"] = ("field_start", FIELD, "none:10," + "a:3,none:37," * 120 + "none:200")
    POKES[f"zl{_j:02d}"] = tuple((0xC500 + 0x60 * i + o, v) for i in range(5) for o, v in ((0x10, 1), (0x11, 0))) \
        + ((0xCA2D, 0x01), (0xC2F0, 0xDB), (0xCA28, _k), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0))
    WAIT_POKES[f"zl{_j:02d}"] = ((("frame", 600), TANK_ENEMIES),)
    # zl04..07: the same battles, the question answered No (Down, then A: 0F:7F8F jp 00:0200, the
    # game's reset), then the title and on (Down / A presses)
    _n = f"zl{_j + 4:02d}"
    SCENARIOS[_n] = ("field_start", FIELD, "none:10," + "a:3,none:37," * 55 + "down:3,none:17,a:3,none:37," * 45 + "none:300")
    POKES[_n] = POKES[f"zl{_j:02d}"]
    WAIT_POKES[_n] = WAIT_POKES[f"zl{_j:02d}"]
# The last battle from a player's save (zj00: field_svi, Mt. Goht, made by tools/ffl3/sav.py from
# .private/saves/s09.sav, local only): formation 7D (Sol, then Xagor by its transformation), A
# every 40 frames; the members' HP 9999 from the first frame wait after frame 600 and again every
# 1500 frames, so the party lasts: Xagor falls, its shattering (02:5167: CC5C & 3 = 3, the SCY
# bounces, the band flashes, the noise steps).
TANK_MEMBERS = tuple(p for b in range(0xD000, 0xD280, 0x80) for p in ((b + 0x10, 0x0F), (b + 0x11, 0x27), (b + 0x12, 0x0F), (b + 0x13, 0x27)))
SCENARIOS["zj00"] = ("field_svi", FIELD, "none:10," + "a:3,none:37," * 2250 + "none:300")
POKES["zj00"] = ((0xC2F0, 0xDB), (0xCA28, 0x7D), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0))
WAIT_POKES["zj00"] = tuple((("frame", f), TANK_MEMBERS) for f in range(600, 90000, 1500))
# A group refilled (zj01: formation 1D, Fireball + Busybody, from field_start with the rich party):
# once a Fireball has fallen, a Fireball's battle ability 7E (action 08 -> 0C:499B) copies a
# monster of its group into the free slot and 02:4F3E (effect 13) shows it (frame 14295); the
# members' HP 9999 every 1500 frames from 600 (ffl3/scratch/effscan3.py found it).
# Pushable objects (zpNN: map 77 through door 34 from field_start, story flag 96 set so its two
# blocks (kind 0B) are shown; the walk found by ffl3/scratch/pushbfs.py to the cell right of the
# first block, then Left held: 8 tries (CA26) per push, 01:46C5; then more pushes or the zf keys)
PUSH_WALK = ("none:200," + "up:17,none:12," * 5 + "left:17,none:12," * 3 + "down:17,none:12," * 2
             + "left:17,none:12,down:17,none:12,left:200,none:30,")
PUSH_POKES = ((0xC2F0, 0xCE), (0xCA28, 0x34), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0), (0xC772, 0x02, 0x02))
SCENARIOS["zp00"] = ("field_start", FIELD, PUSH_WALK + "none:100")
SCENARIOS["zp01"] = ("field_start", FIELD, PUSH_WALK + "up:120,none:20,right:200,none:20,down:200,none:20,left:200,none:100")
SCENARIOS["zp02"] = ("field_start", FIELD, PUSH_WALK + fuzz_plan(8900, 120, FUZZ_FIELD_KEYS))
for _n in ("zp00", "zp01", "zp02"):
    POKES[_n] = PUSH_POKES
SCENARIOS["zj01"] = ("field_start", FIELD, "none:10," + "a:3,none:37," * 425 + "none:300")
POKES["zj01"] = rich_party(0x1D) + ((0xC2F0, 0xDB), (0xCA28, 0x1D), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0))
WAIT_POKES["zj01"] = tuple((("frame", f), TANK_MEMBERS) for f in range(600, 17000, 1500))
for _k, (_gap, _n) in ENEMY_ABILITIES.items():
    SCENARIOS[f"zx{_k:02x}"] = ("field_start", FIELD, "none:10," + f"a:3,none:{_gap - 3}," * (_n // _gap) + "none:10")
    POKES[f"zx{_k:02x}"] = rich_party(_k) + ((0xC2F0, 0xDB), (0xCA28, _k), (0xCA56, 1), (0xCA52, 0), (0xC6E3, 0))
    WAIT_POKES[f"zx{_k:02x}"] = ((("frame", 600), TANK),)

def main(names):
    rec = Recorder()
    sweep = map_sweep() if not names or any(n.startswith("map") and len(n) == 5 for n in names) else {}
    if not names or any(n.startswith("t") and "_" in n for n in names):
        sweep.update(talk_sweep())
    if not names or any(len(n) == 3 and n[0] == "b" for n in names):
        sweep.update(battle_sweep())
    if not names or any(n.startswith("z") for n in names):
        sweep.update(fuzz_sweep())
    try:
        for name in names or list(SCENARIOS) + list(sweep):
            if name in sweep:
                state, hook, plan, pokes, *rest = sweep[name]   # (then save, wait pokes)
                n, w = rec.record(name, state, plan_steps(plan), hook=hook, plan=plan, pokes=pokes, save=rest[0] if rest else None,
                                  hook_vblank=not state.startswith(("field", "boot")) or state.startswith("field_sv"),   # (a save's state: its first field
                                  wait_pokes=rest[1] if len(rest) > 1 else ())                     # loop pass may come mid-frame)
            else:
                state, hook, plan, *save = SCENARIOS[name]
                n, w = rec.record(name, state, plan_steps(plan), hook=hook, plan=plan, pokes=POKES.get(name, ()),
                                  save=save[0] if save else None, hook_vblank=(len(state) == 3 and state[0] == "m") or state.startswith("field_sv"),
                                  wait_pokes=WAIT_POKES.get(name, ()))
            print(f"{name}: {n} frames, {w} waits")
    finally:
        rec.close()


if __name__ == "__main__":
    main(sys.argv[1:])
