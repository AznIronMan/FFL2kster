"""Plan button sequences for Legend I parity scenarios by driving PyBoy from a saved state:
actions run in the emulator, every frame's buttons are logged, and the log is the plan a trace is
then recorded with (same state + same buttons = same run).

Actions: ("goto", x, y) walk there (BFS on the map buffer, ffl1kster.navigate rules),
("face", dir) tap a direction, ("press", button, hold, wait), ("wait", frames),
("reach", x, y) step onto a cell, or when it is blocked walk next to it and push into it,
("talk", x, y) walk next to a cell, face it and press A (both best effort: self.missed counts),
("until_text", needle, max_frames, button_every) press A every N frames until text shows.

Edge-safe input: the port runs a frame's code segment entirely before the next frame's joypad tick
(CPU time inside a frame is not modelled, docs/DECISIONS.md), while the original's longer segments
read the joypad after it (e.g. the field loop iteration that completes a step, or draws a second
random number). A change of the held buttons (FF8D) seen by such a late read would be seen one
frame apart by the two. The planner therefore delays a button change by a frame whenever the
segment that would first see it reads the joypad late (detected in PyBoy: LY < 144 at a read)."""
import sys
from collections import deque
sys.path.insert(0, "src")
from ffl1kster.emu import Emulator
from ffl1kster.navigate import passable, DIRS


# joypad reads: 00:034F (FF8E repeat, called through 00:0174/019B), 00:209D (field movement) and
# 00:0CCD (the text delay's first look at A held, after a character is drawn)
READS = (0x034F, 0x209D, 0x0CCD)


class Planner:
    def __init__(self, state, hook=(0, 0x1243), rom="ffl1/input/original.gb", pokes=()):
        self.e = Emulator(rom).__enter__()
        self.pb = self.e.pb
        self.e.load_state(state if "/" in state else f"ffl1/build/states/{state}.state")
        hit = []
        self.pb.hook_register(hook[0], hook[1], lambda _: hit.append(1), None)
        for _ in range(3000):
            self.pb.tick(1, False)
            if hit:
                break
        self.pb.hook_deregister(hook[0], hook[1])
        for pk in pokes:  # as trace_lib.Recorder.record applies them at the hook
            ad, v = pk[0], pk[1]
            mask = pk[2] if len(pk) > 2 else 0xFF
            self.pb.memory[ad] = (self.pb.memory[ad] & ~mask & 0xFF) | (v & mask)
        self.log = []
        self.held = set()
        self.late = []
        self.states, self.ffs = [], []
        for a in READS:
            self.pb.hook_register(0, a, self._read, None)
        self.delayed = 0
        self.missed = 0

    def _read(self, _):
        if self.pb.memory[0xFF44] < 144:
            self.late.append(1)

    def _tick(self, btn):
        want = set() if btn == "none" else set(btn.split("+"))
        for k in self.held - want:
            self.pb.button_release(k)
        for k in want - self.held:
            self.pb.button_press(k)
        self.held = want
        self.late.clear()
        self.pb.tick(1, False)

    def frame(self, btn="none"):
        """One frame with btn held, edge-safe: when the held-button state FF8D changes in a frame
        whose code reads the joypad late, the change is moved a frame later (rolling back the
        frame where it began). Returns the buttons used for this frame."""
        import io
        st = self.e.state_bytes()
        prev = self.ffs[-1] if self.ffs else self.pb.memory[0xFF8D]
        self._tick(btn)
        ff = self.pb.memory[0xFF8D]
        if self.late and ff != prev:
            self.delayed += 1
            if self.log and btn != self.log[-1]:
                self.pb.load_state(io.BytesIO(st))
                self.held = set() if self.log[-1] == "none" else set(self.log[-1].split("+"))
                return self.frame(self.log[-1])
            if self.log:
                # the change began a frame earlier: redo that frame with the buttons before it
                self.pb.load_state(io.BytesIO(self.states.pop()))
                self.log.pop()
                self.ffs.pop()
                old = self.log[-1] if self.log else "none"
                self.held = set() if old == "none" else set(old.split("+"))
                self.frame(old)
                return self.frame(btn)
        self.log.append(btn)
        self.states.append(st)
        self.ffs.append(ff)
        if len(self.states) > 4:
            self.states[-5] = None
        return btn

    def press(self, b, hold=4, wait=30):
        for _ in range(hold):
            self.frame(b)
        for _ in range(wait):
            self.frame()

    def pos(self):
        return self.e.position()

    def goto(self, x, y, max_steps=200):
        m = self.pb.memory
        target = (x, y)
        for _ in range(max_steps):
            if getattr(self, "budget", None) and len(self.log) >= self.budget:
                return False
            p = self.pos()
            if p == target:
                return True
            q = deque([p]); par = {p: None}
            while q:
                c = q.popleft()
                if c == target:
                    break
                for k, (dx, dy) in DIRS.items():
                    n = (c[0] + dx, c[1] + dy)
                    if n in par or not passable(m, *n):
                        continue
                    par[n] = (c, k); q.append(n)
            if target not in par:
                return False
            c = target; path = []
            while par[c]:
                c, k = par[c]; path.append(k)
            # hold the direction until the position changes (or give up after 40 frames)
            k = path[-1]
            for _ in range(40):
                self.frame(k)
                if self.pos() != p:
                    break
            for _ in range(20):
                self.frame()
                if not m[0xC5B1]:
                    break
        return self.pos() == target

    def text(self):
        return " ".join(x.strip(" ·") for x in self.e.screen_text()[:10] if x.strip(" ·"))

    def run(self, actions, max_frames=None):
        for a in actions:
            if max_frames and len(self.log) >= max_frames:
                self.missed += 1
                break
            k = a[0]
            if k == "goto":
                if not self.goto(a[1], a[2]):
                    raise RuntimeError(f"cannot reach {a[1:]} from {self.pos()}")
            elif k == "face":
                self.press(a[1], 2, 10)
            elif k == "press":
                self.press(a[1], a[2] if len(a) > 2 else 4, a[3] if len(a) > 3 else 30)
            elif k == "wait":
                for _ in range(a[1]):
                    self.frame()
            elif k in ("reach", "talk"):
                self.approach(k, a[1], a[2], max_frames)
        return self.log

    def approach(self, kind, x, y, max_frames=None):
        m = self.pb.memory
        self.budget = max_frames
        if kind == "reach" and passable(m, x, y):
            if not self.goto(x, y, max_steps=40):
                self.missed += 1
            return
        for k, (dx, dy) in DIRS.items():
            n = (x - dx, y - dy)  # stand at n, then direction k leads to (x, y)
            if not passable(m, *n) or not self.goto(*n, max_steps=40):
                continue
            if kind == "reach":
                self.press(k, 16, 30)
            else:
                self.press(k, 2, 10)
                self.press("a", 4, 60)
            return
        self.missed += 1

    def plan(self):
        """Run-length plan string for traces.py."""
        out, prev, n = [], None, 0
        for b in self.log:
            if b == prev:
                n += 1
            else:
                if prev is not None:
                    out.append(f"{prev}:{n}")
                prev, n = b, 1
        if prev is not None:
            out.append(f"{prev}:{n}")
        return ",".join(out)
