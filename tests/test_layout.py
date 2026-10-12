"""Map layout decoder (ffl2kster.layout) vs captures and vs the ROM routine (ffl2kster.sm83)."""
import json

from ffl2kster import layout
from ffl2kster.schema import maps as M
from ffl2kster.sm83 import CPU
from conftest import ROOT


def _oracle(rom, ptr, flags, vars_bytes=bytes(16)):
    cpu = CPU(rom)
    cpu.mem[0xC2F6:0xC306] = vars_bytes
    cpu.mem[0xC44E] = ptr & 0xFF; cpu.mem[0xC44F] = ptr >> 8; cpu.mem[0xC451] = flags & 0x0F
    cpu.call(0x2232)
    return bytes(cpu.mem[0xD000:0xE000])


def _vars(vb):
    return [(vb[v // 2] >> (0 if v & 1 else 4)) & 0x0F for v in range(32)]


def test_unconditional_layouts_match_emulator_captures(rom_bytes):
    d = json.loads((ROOT / "data" / "maps" / "maps.json").read_text())["headers"]
    n = 0
    for k, h in d.items():
        off = layout.stream_offset(h["layout_ptr"])
        if k == "634c" or any(o["op"] == "if_var" for o in layout.parse(rom_bytes, off)):
            continue        # 634c capture is invalid (battle data in the buffer)
        got = layout.render(rom_bytes, off, None, h["flags"] & 0x0F)
        cap = b"".join(bytes.fromhex(r) for r in h["layout"])
        assert bytes(x & 0x7F for x in got) == bytes(x & 0x7F for x in cap), k   # bit 7 = objects
        n += 1
    assert n >= 180


def test_conditional_layouts_match_rom_routine(rom_bytes):
    heads = [h for h in M.all_headers(rom_bytes)
             if any(o["op"] == "if_var" for o in layout.parse(rom_bytes, layout.stream_offset(M.header(rom_bytes, h)["layout_ptr"])))]
    assert len(heads) == 28
    for i, h in enumerate(heads[:10]):
        hd = M.header(rom_bytes, h)
        vb = bytes(((i * 37 + k * 11) & 0xFF) for k in range(16))
        got = layout.render(rom_bytes, layout.stream_offset(hd["layout_ptr"]), _vars(vb), hd["flags"] & 0x0F)
        assert bytes(got) == _oracle(rom_bytes, hd["layout_ptr"], hd["flags"], vb), hex(h)


def test_tileset_sources_match_captured_vram(rom_bytes):
    """ROM-derived BG tiles (gfx.vram_bg) equal captured VRAM, except animated metatiles 30/31
    (needs build/maps captures; skipped otherwise)."""
    import glob
    import pytest
    from ffl2kster import gfx
    np = pytest.importorskip("numpy")
    caps = sorted(glob.glob(str(ROOT / "build" / "maps" / "*.npz")))
    if not caps:
        pytest.skip("no map captures")
    d = json.loads((ROOT / "data" / "maps" / "maps.json").read_text())["headers"]
    n = 0
    for f in caps:
        k = f.split("/")[-1][:4]
        if k == "634c":
            continue
        v = bytes(np.load(f)["vram"])[0x800:0x1800]
        exp = gfx.vram_bg(rom_bytes, d[k]["b2"])
        assert v[:0x800] == exp[:0x800] and v[0x800:0x800 + 64 * 30] == exp[0x800:0x800 + 64 * 30], k
        n += 1
    assert n == 211
