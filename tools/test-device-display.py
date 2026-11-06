"""Explicit hardware color-pattern test. Reads local credentials, never prints them."""
import argparse
import http.client
import json
import struct
import time
import urllib.error
import uuid
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument('--seconds', type=float, default=180)
parser.add_argument('--x-gap', type=int, default=0)
parser.add_argument('--y-gap', type=int, default=0)
parser.add_argument('--bgr', action='store_true')
parser.add_argument('--invert', action='store_true')
parser.add_argument('--swap', action='store_true')
parser.add_argument('--mirror-x', action='store_true')
parser.add_argument('--mirror-y', action='store_true')
parser.add_argument('--pattern', choices=['bars', 'border'], default='bars')
args = parser.parse_args()
if not 1 <= args.seconds <= 600:
    parser.error('seconds must be 1..600')
root = Path(__file__).resolve().parent.parent
device = json.loads((root / 'tools/data/device.json').read_text(encoding='utf-8-sig'))
base = device['endpoint'].rstrip('/') + '/lease-voice/v1/'
address = urlsplit(base)
connection = (http.client.HTTPSConnection if address.scheme == 'https' else http.client.HTTPConnection)(address.hostname, address.port, timeout=5)
local_ports = set()
auth = {'Authorization': 'Bearer ' + device['token']}


def request(path, body=None, raw=None, headers=None):
    data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
    connection.request('GET' if data is None else 'POST', address.path + path, body=data, headers={**auth,
        'Content-Type': 'application/octet-stream' if raw is not None else 'application/json', **(headers or {})})
    if connection.sock is not None:
        local_ports.add(connection.sock.getsockname()[1])
    response = connection.getresponse()
    payload = response.read()  # Drain before reusing the same HTTP/1.1 connection.
    if response.status >= 400:
        raise urllib.error.HTTPError(base + path, response.status, 'Device rejected request', response.headers, None)
    result = json.loads(payload)
    if result.get('protocol') != 1 or result.get('ok') is False:
        raise RuntimeError('Device rejected display request')
    return result


config = {'protocol': 1, 'action': 'configure', 'profile': 'st7735-128x160',
    'xGap': args.x_gap, 'yGap': args.y_gap, 'bgr': args.bgr, 'invert': args.invert,
    'swapXY': args.swap, 'mirrorX': args.mirror_x, 'mirrorY': args.mirror_y}
report = {'config': config, 'pattern': args.pattern, 'visualConfirmed': False, 'frames': 0}
stream_id = 'screen-test-' + uuid.uuid4().hex
started = False
try:
    info = request('info')
    if 'display-rgb565' not in info.get('capabilities', []):
        raise RuntimeError('Firmware lacks display receiver')
    report['firmware'] = info['firmware']
    status = request('display')
    if status.get('streamId'):
        raise RuntimeError('Display is already owned by another stream')
    status = request('display', config)
    if not status.get('ready'):
        raise RuntimeError('Display driver did not initialize')
    width, height = status['width'], status['height']
    colors = [0xf800, 0x07e0, 0x001f, 0xffff, 0x0000]
    pixels = bytearray()
    for y in range(height):
        for x in range(width):
            color = colors[min(4, x * 5 // width)]
            if args.pattern == 'border':
                if x in (0, width - 1) or y in (0, height - 1):
                    color = 0xffff
                elif x in (1, width - 2) or y in (1, height - 2):
                    color = 0x0000
                elif x == width // 2 or y == height // 2:
                    color = 0xffe0
            pixels.extend(struct.pack('>H', color))
    status = request('display', {'protocol': 1, 'action': 'start', 'streamId': stream_id})
    if status.get('streamId') != stream_id:
        raise RuntimeError('Stream identity mismatch')
    started = True
    print(json.dumps({'event': 'started', 'firmware': info['firmware'], 'width': width,
        'height': height, 'expected': 'red green blue white black left-to-right', 'config': config}), flush=True)
    deadline, last_log = time.monotonic() + args.seconds, 0
    while time.monotonic() < deadline:
        begin = time.monotonic()
        sequence = report['frames'] + 1
        try:
            ack = request('frame', raw=pixels, headers={'X-Lease-Stream-Id': stream_id,
                'X-Lease-Sequence': str(sequence), 'X-Lease-Width': str(width), 'X-Lease-Height': str(height)})
        except urllib.error.HTTPError as error:
            if error.code == 409 and request('display').get('streamId') != stream_id:
                report['externallyStopped'] = True
                print(json.dumps({'event': 'externally-stopped'}), flush=True)
                break
            raise
        if ack.get('streamId') != stream_id or ack.get('sequence') != sequence:
            raise RuntimeError('Frame identity mismatch')
        report['frames'] = sequence
        if sequence == 1 or time.monotonic() - last_log >= 10:
            status = request('display')
            print(json.dumps({'event': 'progress', 'sent': sequence, 'received': status['received'],
                'drawn': status['drawn'], 'displayError': status.get('displayError')}), flush=True)
            last_log = time.monotonic()
        time.sleep(max(0, 0.2 - (time.monotonic() - begin)))
    report['final'] = request('display')
except Exception as error:
    report['errorType'] = type(error).__name__
    print(json.dumps({'event': 'failed', 'type': type(error).__name__}), flush=True)
    raise
finally:
    if started:
        try:
            report['stopped'] = request('display', {'protocol': 1, 'action': 'stop', 'streamId': stream_id})
        except Exception as error:
            report['stopErrorType'] = type(error).__name__
    report['transportLocalPorts'] = sorted(local_ports)
    connection.close()
    destination = root / 'firmware/esp32-s3/artifacts/acceptance'
    destination.mkdir(parents=True, exist_ok=True)
    name = 'm3-display-' + time.strftime('%Y%m%d-%H%M%S') + '.json'
    (destination / name).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
