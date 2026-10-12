"""Instruction-level ROM-read tracer: hook every byte that could be a memory-read opcode in
selected banks; log (bank, pc, address read) for reads that target ROM (0x0000-0x7FFF).
Data bytes that happen to equal an opcode are never executed, so they are harmless.
usage: read_trace.py ROM STATE "a:50,a:50" [banks]"""
import sys
sys.path.insert(0, 'src')
from ffl2kster.emu import Emulator

ROM, STATE, STEPS = sys.argv[1], sys.argv[2], sys.argv[3]
BANKS = [int(x, 16) for x in (sys.argv[4] if len(sys.argv) > 4 else '0,1,c,d,f').split(',')]
rom = open(ROM, 'rb').read()
HL_OPS = {0x7E, 0x2A, 0x3A, 0x46, 0x4E, 0x56, 0x5E, 0x66, 0x6E, 0x86, 0x8E, 0x96, 0xBE, 0xA6, 0xB6, 0xAE}
DE_OPS, BC_OPS = {0x1A}, {0x0A}


def trace(steps):
    with Emulator(ROM) as e:
        e.load_state(STATE)
        pb = e.pb
        log = []
        def mk(bank, pc, reg):
            def cb(_):
                r = pb.register_file
                addr = r.HL if reg == 'hl' else ((r.D << 8) | r.E if reg == 'de' else (r.B << 8) | r.C)
                if addr < 0x8000:
                    cur = pb.memory[0x2000] if False else None
                    log.append((bank, pc, addr))
            return cb
        n = 0
        for b in BANKS:
            lo, hi = (0, 0x4000) if b == 0 else (0x4000, 0x8000)
            base = b * 0x4000
            for pc in range(lo, hi):
                op = rom[base + pc - lo]
                reg = 'hl' if op in HL_OPS else 'de' if op in DE_OPS else 'bc' if op in BC_OPS else None
                if reg:
                    try:
                        pb.hook_register(b, pc, mk(b, pc, reg), None); n += 1
                    except Exception:
                        pass
        for st in steps.split(','):
            k, _, w = st.partition(':')
            pb.button(k, 6); pb.tick(int(w or 40), False)
        return n, log, e


if __name__ == '__main__':
    n, log, _ = trace(STEPS)
    from collections import Counter
    print('hooks', n, 'reads', len(log))
    c = Counter((b, pc, a & 0xFFF0) for b, pc, a in log)
    for (b, pc, a), k in sorted(c.items(), key=lambda x: (x[0][0], x[0][1])):
        print(f'code {b:02X}:{pc:04X} reads ~{a:04X} x{k}')
