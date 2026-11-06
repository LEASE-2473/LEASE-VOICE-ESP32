"""Verify a release without opening a serial port. Run with IDF Python."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import zipfile

if not __debug__:
    raise RuntimeError('Run verification without Python -O; assertions are required')

parser = argparse.ArgumentParser()
parser.add_argument('release', type=Path)
args = parser.parse_args()
release = args.release
manifest = json.loads((release / 'manifest.json').read_text())
flash = json.loads((release / 'flasher_args.json').read_text())
assert manifest['target'] == 'esp32s3'
assert manifest['hardware_tested'] is False
assert manifest['image_type'] == 'separate'
assert manifest['milestone'] in ('M0', 'M1', 'M2', 'M3')
assert manifest['idf_version'].startswith('v5.3.1') or manifest['idf_version'] == '5.3.1'
assert manifest['flash_settings'] == flash['flash_settings']
assert manifest['flash_settings'] == {'flash_mode': 'dio', 'flash_size': '16MB', 'flash_freq': '40m'}
for line in (release / 'SHA256SUMS.txt').read_text().splitlines():
    digest, name = line.split('  ', 1)
    assert hashlib.sha256((release / name).read_bytes()).hexdigest() == digest, name
regions = []
for image in manifest['images']:
    path = release / image['file']
    assert path.stat().st_size == image['size']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == image['sha256']
    assert Path(flash['flash_files'][image['address']]).name == image['file']
    start = int(image['address'], 0)
    end = start + image['size']
    assert end <= 16 * 1024 * 1024
    assert all(end <= a or start >= b for a, b in regions), 'overlapping images'
    regions.append((start, end))
assert len(regions) == len(flash['flash_files']) == 3
assert {int(i['address'], 0): i['file'] for i in manifest['images']} == {
    0x0: 'bootloader.bin', 0x8000: 'partition-table.bin', 0x10000: 'lease_voice.bin'}
config = json.loads((release / 'sdkconfig.json').read_text())
for name in ('SPIRAM', 'SPIRAM_MODE_OCT', 'SPIRAM_SPEED_80M', 'SPIRAM_MEMTEST',
             'ESPTOOLPY_FLASHSIZE_16MB', 'ESP_CONSOLE_UART_DEFAULT',
             'ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG', 'APP_REPRODUCIBLE_BUILD'):
    assert config[name] is True, name
assert not config['SECURE_BOOT']
assert not config['SECURE_FLASH_ENC_ENABLED']
assert config['ESP_DEFAULT_CPU_FREQ_MHZ'] == 160
assert config['ESP_CONSOLE_UART_BAUDRATE'] == 115200
assert config['PARTITION_TABLE_OFFSET'] == 0x8000
partitions = (release / 'partition-table.bin').read_bytes()
entries = {}
for offset in range(0, len(partitions), 32):
    entry = partitions[offset:offset + 32]
    if entry[:2] != b'\xaa\x50':
        break
    _, kind, subtype, address, size, label, flags = struct.unpack('<HBBII16sI', entry)
    entries[label.rstrip(b'\0').decode()] = (kind, subtype, address, size, flags)
assert entries == {'nvs': (1, 2, 0x9000, 0x6000, 0),
                   'phy_init': (1, 1, 0xf000, 0x1000, 0),
                   'factory': (0, 0, 0x10000, 0x400000, 0)}
assert (release / 'lease_voice.bin').stat().st_size <= entries['factory'][3]
with zipfile.ZipFile(release / 'source.zip') as archive:
    assert archive.testzip() is None
    cmake = archive.read('CMakeLists.txt').decode()
    assert f'"{manifest["version"]}"' in cmake
for name in ('bootloader.bin', 'lease_voice.bin'):
    header = (release / name).read_bytes()[:24]
    assert header[0] == 0xe9 and header[2] == 2 and header[3] == 0x40, name
    assert struct.unpack_from('<H', header, 12)[0] == 9, name
    subprocess.run([sys.executable, '-m', 'esptool', '--chip', 'esp32s3',
                    'image_info', str(release / name)], check=True)
print('PASS: checksums, flash manifest, configuration, partitions, source archive and image checks')
