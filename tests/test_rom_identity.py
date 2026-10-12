import hashlib

from ffl2kster import rom as romlib
from conftest import EXPECTED_SHA256


def test_hashes_and_size(rom_bytes):
    assert len(rom_bytes) == 262144
    assert hashlib.sha256(rom_bytes).hexdigest() == EXPECTED_SHA256
    assert hashlib.md5(rom_bytes).hexdigest() == "4052912f83ddc2722dbc5409907ad8fa"


def test_header(rom_bytes):
    h = romlib.parse_header(rom_bytes)
    assert h.title == "SAGA2"
    assert h.cart_type == 0x03 and h.cart_type_name == "MBC1+RAM+BATTERY"
    assert h.rom_size_code == 0x03 and h.rom_size_bytes == 256 * 1024
    assert h.ram_size_code == 0x02 and h.ram_size_bytes == 8 * 1024
    assert h.destination == 0x01
    assert h.version == 0
    assert h.cgb_flag == 0
    assert h.logo_ok


def test_checksums_valid(rom_bytes):
    h = romlib.parse_header(rom_bytes)
    assert h.header_checksum_ok and h.header_checksum == 0xCD
    assert h.global_checksum_ok and h.global_checksum == 0xD970


def test_bank_conversion_roundtrip():
    for off in (0x0, 0x150, 0x3FFF, 0x4000, 0x7FFF, 0x2C123, 0x3FFFF):
        b, a = romlib.file_to_bank(off)
        assert romlib.bank_to_file(b, a) == off
    assert romlib.file_to_bank(0x2C000) == (0x0B, 0x4000)
