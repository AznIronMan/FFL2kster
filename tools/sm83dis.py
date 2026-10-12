"""Tiny SM83 linear disassembler for analysis (uses mgbdis's opcode table from MGBDIS env/path).
Functions: decode(rom, bank, addr) -> (length, text, target)"""
import importlib.util, os, re
_P = os.environ.get('MGBDIS', os.path.expanduser('~/tools/mgbdis')) + '/instruction_set.py'
_spec = importlib.util.spec_from_file_location('iset', _P)
_iset = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_iset)
I, CB = _iset.instructions, _iset.cb_instructions


def off(bank, addr):
    return addr if addr < 0x4000 else bank * 0x4000 + addr - 0x4000


def decode(rom, bank, addr):
    o = off(bank, addr); op = rom[o]
    if op == 0xCB:
        return 2, CB[rom[o + 1]], None
    m = I.get(op, 'db')
    if op in (0xC7, 0xCF, 0xD7, 0xDF, 0xE7, 0xEF, 0xF7, 0xFF):
        return 1, f'rst ${op - 0xC7:02x}', None
    n = 1; tgt = None; txt = m
    if 'd16' in m or 'a16' in m:
        v = rom[o + 1] | rom[o + 2] << 8; n = 3
        txt = m.replace('d16', f'${v:04x}').replace('a16', f'${v:04x}')
        if m.startswith(('jp', 'call')): tgt = v
    elif 'd8' in m or 'a8' in m:
        v = rom[o + 1]; n = 2; txt = m.replace('d8', f'${v:02x}').replace('a8', f'${v:02x}')
    elif 'r8' in m:
        r = rom[o + 1]; r = r - 256 if r > 127 else r; n = 2; tgt = addr + 2 + r
        txt = re.sub(r'pc\+r8', f'${tgt:04x}', m)
    return n, txt, tgt
