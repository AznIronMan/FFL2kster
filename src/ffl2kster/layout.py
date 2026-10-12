"""Map layout command format (drawer 00:2253) — decoder and exact re-implementation.

A map header's layout pointer p selects bank 09 (p >= 0x4000) or bank 08 at p + 0x4000
(00:223E). The stream is a list of 2-byte commands [b, c]: op = b >> 4, n = b & 0x0F.
A 12-bit position (n << 8 | c) is a map offset (y·64 + x); "pos" below means
x = c & 0x3F, y = ((n << 8 | c) >> 6) & 0x3F (00:2625). Tile specs (00:2606): one byte t;
if t & 0xC0 == 0 the pattern is the single tile t, else tiles (t & 0x3F, next byte) alternate.

op 0 end
op 1 set tile: map[n<<8|c] = next & 0x3F
op 2 cursor = pos
op 3 rectangle outline cursor..pos, alternating tiles along the perimeter
op 4 filled rectangle cursor..pos, checkerboard of the two tiles
op 5 circle around the cursor with radius |dx|+|dy| to pos (r < 8: tables at 00:2670,
     else a Minsky-style integer circle with r·8+1 points), single tile
op 6 line cursor..pos (DDA), alternating tiles; op 9 line from the previous line's end
op 7 fill the whole map with a two-tile checkerboard (tiles = pos.x, pos.y)
op 8 scanline flood fill from the cursor with tile pos.x (replaces the cursor tile's value)
op 10 continue only if progress var n is in [c >> 4, c & 0x0F], else end

After drawing, 00:2647 turns metatiles 3..3+k-1 (k = header flags & 0x0F) into trigger tiles
0x40 | idx (bit 5 kept), saving the original metatile at C500+idx. Runtime object occupancy
sets bit 7 (not part of the layout). Verified bit-exactly against the ROM routine run in
ffl2kster.sm83 (all 211 valid captures; randomized progress variables; fuzzed streams).
"""
from __future__ import annotations

CIRCLE_TABLE = 0x2670


def stream_offset(layout_ptr: int) -> int:
    if layout_ptr & 0x4000:
        return 0x09 * 0x4000 + (layout_ptr & 0xFFFF) - 0x4000
    return 0x08 * 0x4000 + layout_ptr          # bank 08 at ptr + 0x4000


def progress_var(vars_: list[int] | bytes, v: int) -> int:
    return vars_[v & 0x1F] & 0x0F


def _pos(n: int, c: int) -> tuple[int, int]:
    w = (n << 8 | c) << 2
    return c & 0x3F, (w >> 8) & 0x3F


def _tiles(rom, p):
    t = rom[p]
    if t & 0xC0 == 0:
        return t, t, p + 1
    return t & 0x3F, rom[p + 1], p + 2


def circle_table(rom: bytes, r: int) -> list[tuple[int, int]]:
    p = rom[CIRCLE_TABLE + 2 * (r - 1)] | rom[CIRCLE_TABLE + 2 * (r - 1) + 1] << 8
    out = []
    while rom[p] != 0xFF:
        out.append((rom[p], rom[p + 1])); p += 2
    return out


class Grid:
    def __init__(self):
        self.m = bytearray(4096)
        self.budget = 1_000_000

    @staticmethod
    def addr(x: int, y: int) -> int:
        hi = 0xD0 + (y >> 2)
        lo = (((y & 3) << 6) | x) & 0xFF
        return ((hi << 8) | lo) - 0xD000

    def get(self, x, y):
        a = self.addr(x & 0xFF, y & 0xFF)
        return self.m[a] if 0 <= a < 4096 else 0

    def put(self, x, y, t):
        self.budget -= 1
        if self.budget < 0:
            raise RuntimeError("layout drawing does not terminate")
        a = self.addr(x & 0xFF, y & 0xFF)
        if 0 <= a < 4096:
            self.m[a] = t & 0xFF


def parse(rom: bytes, offset: int) -> list[dict]:
    """Decode the command stream (stops at op 0 or an unknown op)."""
    ops, p = [], offset
    while True:
        b, c = rom[p], rom[p + 1]; op, n = b >> 4, b & 0x0F; p += 2
        if op == 0:
            ops.append({"op": "end"}); break
        x, y = _pos(n, c)
        if op == 1:
            ops.append({"op": "tile", "offset": n << 8 | c, "tile": rom[p] & 0x3F}); p += 1
        elif op == 2:
            ops.append({"op": "cursor", "x": x, "y": y})
        elif op in (3, 4, 5, 6, 9):
            e, d, p = _tiles(rom, p)
            name = {3: "rect", 4: "fill_rect", 5: "circle", 6: "line", 9: "line_cont"}[op]
            ops.append({"op": name, "x": x, "y": y, "tiles": [e, d]})
        elif op == 7:
            ops.append({"op": "fill", "tiles": [x, y]})
        elif op == 8:
            ops.append({"op": "flood", "tile": x})
        elif op == 10:
            ops.append({"op": "if_var", "var": n, "min": c >> 4, "max": c & 0x0F})
        else:
            ops.append({"op": f"unknown_{op}"}); break
    return ops


def render(rom: bytes, offset: int, vars_=None, trigger_count: int = 0,
           saved: bytearray | None = None, cursor=(0, 0), last_end=(0, 0),
           max_points: int = 1_000_000) -> bytearray:
    """Run the layout stream like 00:2253 (+ 00:2647 when trigger_count > 0).
    cursor/last_end: initial C473/C474 and C475/C476 (stale RAM in the game; every real
    layout sets the cursor before using it)."""
    vars_ = vars_ or [0] * 32
    g = Grid()
    g.budget = max_points
    cur = list(cursor)     # C473/C474
    last = list(last_end)  # C475/C476
    p = offset
    while True:
        b, c = rom[p], rom[p + 1]; op, n = b >> 4, b & 0x0F; p += 2
        if op == 0:
            break
        if op == 1:
            off = n << 8 | c
            g.m[off] = rom[p] & 0x3F; p += 1
            continue
        x, y = _pos(n, c)
        if op == 2:
            cur = [x, y]; continue
        if op == 7:
            t1, t2 = x, y
            for row in range(64):
                for col in range(0, 64, 2):
                    g.m[row * 64 + col], g.m[row * 64 + col + 1] = t1, t2
                t1, t2 = t2, t1
            continue
        if op == 8:
            _flood(g, cur[0], cur[1], x); continue
        if op == 10:
            v = progress_var(vars_, n)
            if (c & 0x0F) < v:
                break
            hi = c >> 4
            if hi == v or hi < v:
                continue
            break
        if op not in (3, 4, 5, 6, 9):
            break
        e, d, p = _tiles(rom, p)
        if op == 3:
            _rect(g, cur, x, y, e, d)
        elif op == 4:
            _fill_rect(g, cur, x, y, e, d)
        elif op == 5:
            _circle(rom, g, cur, x, y, e)
        else:
            start = cur if op == 6 else last
            last = [x, y]
            _line(g, start, x, y, e, d)
    if trigger_count:
        _triggers(g, trigger_count, saved)
    return g.m


def _order(cur, x, y):
    l, h, c, b = cur[0], cur[1], x, y
    if not l < c:
        l, c = c, l
    if not h < b:
        h, b = b, h
    return l, h, c, b


def _rect(g, cur, x, y, e, d):
    l, h, c, b = _order(cur, x, y)
    minx, miny = l, h
    while True:
        g.put(l, h, e)
        if l & 0xFF == c: break
        e, d = d, e; l = (l + 1) & 0xFF
    while True:
        g.put(l, h, e)
        if h & 0xFF == b: break
        e, d = d, e; h = (h + 1) & 0xFF
    while True:
        g.put(l, h, e)
        if l & 0xFF == minx: break
        e, d = d, e; l = (l - 1) & 0xFF
    while True:
        g.put(l, h, e)
        if h & 0xFF == miny: break
        e, d = d, e; h = (h - 1) & 0xFF


def _fill_rect(g, cur, x, y, e, d):
    l, h, c, b = _order(cur, x, y)
    while True:
        row_l, row_e, row_d = l, e, d
        while True:
            g.put(l, h, e)
            if l & 0xFF == c: break
            e, d = d, e; l = (l + 1) & 0xFF
        l, e, d = row_l, row_e, row_d
        if h & 0xFF == b: break
        e, d = d, e; h = (h + 1) & 0xFF


def _line(g, start, x, y, e, d):
    l, h = start
    dx, dy = (x - l) & 0xFF, (y - h) & 0xFF
    sx = sy = 1
    stx, sty = 1, 1
    if dx >= 0x80:
        dx = (-dx) & 0xFF; sx = stx = 0xFF
    if dy >= 0x80:
        dy = (-dy) & 0xFF; sy = sty = 0xFF
    if dx >= dy:
        major, minor = dx, dy; sty = 0
    else:
        major, minor = dy, dx; stx = 0
    acc = (major >> 1) or 1
    while True:
        g.put(l, h, e)
        e, d = d, e
        if l == x and h == y:
            break
        acc = (acc + minor) & 0xFF
        if major >= acc:
            l = (l + stx) & 0xFF; h = (h + sty) & 0xFF
        else:
            l = (l + sx) & 0xFF; h = (h + sy) & 0xFF
            acc = (acc - major) & 0xFF


def _udiv(v, r):
    """00:24CC: 16-bit / 8-bit restoring division exactly as coded (r = 0 gives 0xFFFF)."""
    a, q = 0, 0
    for _ in range(16):
        a = ((a << 1) | (v >> 15)) & 0xFF
        v = (v << 1) & 0xFFFF
        bit = 1 if a >= r else 0
        q = ((q << 1) | bit) & 0xFFFF
        if bit:
            a = (a - r) & 0xFF
    return q


def _sdiv(v, r):
    v &= 0xFFFF
    if v >= 0x8000:
        q = _udiv((0x10000 - v) & 0xFFFF, r)
        return (0x10000 - q) & 0xFFFF
    return _udiv(v, r)


def _circle(rom, g, cur, x, y, tile):
    l, h = cur
    c = (x - l) & 0xFF; b = (y - h) & 0xFF
    ax = c if c < 0x80 else (-c) & 0xFF
    ay = b if b < 0x80 else (-b) & 0xFF
    r = (ax + ay) & 0xFF
    if r and r < 8:
        for oc, ob in circle_table(rom, r):
            for px, py in (((l + oc), (h + ob)), ((l + ob), (h - oc)), ((l - oc), (h - ob)), ((l - ob), (h + oc))):
                px &= 0xFF; py &= 0xFF
                if px < 0x40 and py < 0x40:
                    g.put(px, py, tile)
        return
    count = (r * 8 + 1) & 0xFFFF
    bc = (c << 8) & 0xFFFF
    de = (b << 8) & 0xFFFF
    while True:
        bc = (bc + _sdiv(de, r)) & 0xFFFF
        de = (de - _sdiv(bc, r)) & 0xFFFF
        px = (l + (bc >> 8)) & 0xFF
        if px < 0x40:
            py = (h + (de >> 8)) & 0xFF
            if py < 0x40:
                g.put(px, py, tile)
        count = (count - 1) & 0xFFFF
        if count == 0:
            break


def _flood(g, cx, cy, tile):
    d = g.get(cx, cy)

    def row(c, b):
        x = c
        while True:
            if g.get(x, b) != d: break
            g.put(x, b, tile)
            x = (x + 1) & 0xFF
            if x >= 0x40: break
        x = (c - 1) & 0xFF
        while True:
            if g.get(x, b) != d: break
            g.put(x, b, tile)
            x = (x - 1) & 0xFF
            if x >= 0x40: break

    b = cy
    while True:
        if g.get(cx, b) != d: break
        row(cx, b)
        b = (b + 1) & 0xFF
        if b >= 0x40: break
    b = (cy - 1) & 0xFF
    while True:
        if g.get(cx, b) != d: break
        row(cx, b)
        b = (b - 1) & 0xFF
        if b >= 0x40: break


def _triggers(g, k, saved):
    hi = k + 3
    idx = 0
    for a in range(4096):
        v = g.m[a]
        t = v & 0x1F
        if 3 <= t < hi:
            if saved is not None:
                saved[idx & 0xFF] = v
            g.m[a] = (v & 0x20) | 0x40 | (idx & 0xFF)
            idx += 1
    # note: 00:2647 uses E (low byte of C500+idx) as the index, so idx wraps at 256
