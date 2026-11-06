"""Hardware regression: partial upload must remain cancelable. No synthesis."""
import json
import socket
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parent.parent
device = json.loads((root / 'tools/data/device.json').read_text(encoding='utf-8-sig'))
base = device['endpoint'].rstrip('/')
address = urlsplit(base)
headers = {'Authorization': 'Bearer ' + device['token']}

def request(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + '/lease-voice/v1/' + path, data=data,
        headers={**headers, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.load(response)

report = {'before': request('info')}
task_id = 'hardware-upload-cancel-final'
upload = socket.create_connection((address.hostname, address.port or 80), timeout=3)
try:
    message = ('POST /lease-voice/v1/audio HTTP/1.1\r\n'
        f'Host: {address.hostname}\r\nAuthorization: Bearer {device["token"]}\r\n'
        'Content-Type: application/octet-stream\r\nContent-Length: 48000\r\n'
        f'X-Lease-Audio-Id: {task_id}\r\nX-Lease-Sample-Rate: 24000\r\n\r\n')
    upload.sendall(message.encode() + bytes(1000))
    time.sleep(0.2)
    report['during'] = request('playback')
    assert report['during']['id'] == task_id and report['during']['state'] == 'queued', report['during']
    start = time.monotonic()
    report['stop'] = request('command', {'protocol': 1, 'action': 'stop', 'id': task_id})
    report['stopSeconds'] = round(time.monotonic() - start, 3)
    assert report['stop']['ok'], report['stop']
finally:
    upload.close()
report['after'] = request('playback')
assert report['after']['id'] == task_id and report['after']['state'] == 'stopped', report['after']
report['recovered'] = request('info')
destination = root / 'firmware/esp32-s3/artifacts/acceptance/m2.3-upload-cancel.json'
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'result': 'PASS', 'state': report['after']['state'], 'stopSeconds': report['stopSeconds'],
    'firmware': report['recovered']['firmware']}))
