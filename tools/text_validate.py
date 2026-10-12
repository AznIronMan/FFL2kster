"""Text alignment validator: decodes every table entry over its region and reports entries
whose decode overruns the next entry or does not finish on an end code (0x00).
Used to refine script_text.ARGS (an argument-count error misaligns the rest of a stream).
Usage: python tools/text_validate.py [rom] [--show]"""
import sys
sys.path.insert(0, "src")
from ffl2kster import script_text as st

def check(rom):
    bad = []; total = 0
    for name, i, o, end in st.table_entries(rom):
        if end is None:
            continue
        total += 1
        toks, e = st.decode_stream(rom, o, limit=end - o, stop_at_end=False)
        last = toks[-1] if toks else None
        ok = e == end and not isinstance(last, str) and last is not None and last[0] == 0
        if not ok:
            bad.append((name, i, o, end, e, st.render(toks)[-80:]))
    return total, bad

if __name__ == "__main__":
    rom = open(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "input/original.gb", "rb").read()
    total, bad = check(rom)
    print(f"aligned {total - len(bad)}/{total}")
    if "--show" in sys.argv:
        for b in bad:
            print(b[0], b[1], hex(b[2]), hex(b[3]), hex(b[4]), repr(b[5]))
