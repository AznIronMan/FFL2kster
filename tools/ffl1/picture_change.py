"""Legend I monster pictures: the picture loaded into VRAM 8800 for the first battle against the
prediction from ffl1kster.gfx.picture, for ASIGARU, SKELETON (area swap) and a controlled change of
ASIGARU's family byte (02:7900+155: picture index 13 -> 2).
usage: python tools/ffl1/picture_change.py"""
import os, sys, tempfile
sys.path.insert(0, "src")
from ffl1kster import gfx
from ffl1kster.emu import Emulator
from ffl1kster.rom import bank_to_file

orig = open("ffl1/input/original.gb", "rb").read()
AREA = bank_to_file(6, 0x6868)

if __name__ == "__main__":
    for label, pt in [("ASIGARU", []), ("SKELETON via area swap", [(AREA + 5 * 19 + 2, 0x60)]),
                      ("ASIGARU family byte 0x1D -> 0x12", [(gfx.FAMILY + 155, 0x12)])]:
        r = bytearray(orig)
        for o, v in pt:
            r[o] = v
        fd, p = tempfile.mkstemp(suffix=".gb")
        os.write(fd, bytes(r)); os.close(fd)
        with Emulator(p) as e:
            e.load_state("ffl1/build/states/pre_battle.state")
            e.step_into_battle("right")
            mid, vram = e.pb.memory[0xD09F], bytes(e.pb.memory[0x8800:0x8800 + 48 * 16])
        os.remove(p)
        pic = gfx.picture(bytes(r), mid)
        print(f"{label:34s} id {mid:3d} class {pic['class']} index {pic['index']:2d} "
              f"VRAM equals prediction: {vram[:len(pic['data'])] == pic['data']}")
