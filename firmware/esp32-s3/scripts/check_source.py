"""Read-only SDK/source checks; does not activate SDK, compile or access devices."""
import argparse
from pathlib import Path
import re

parser = argparse.ArgumentParser()
parser.add_argument('--idf-path', type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parents[1]
idf = args.idf_path
version = (idf / 'tools/cmake/version.cmake').read_text(encoding='utf-8')
for part, value in [('MAJOR', 5), ('MINOR', 3), ('PATCH', 1)]:
    if not re.search(rf'set\(IDF_VERSION_{part}\s+{value}\)', version):
        raise RuntimeError('Expected SDK 5.3.1 source')
definitions = set()
for path in idf.rglob('Kconfig*'):
    if path.is_file():
        definitions.update(re.findall(r'^\s*(?:menu)?config\s+(\w+)',
                                      path.read_text(encoding='utf-8'), re.M))
defaults = (source / 'sdkconfig.defaults').read_text(encoding='utf-8')
required_configs = re.findall(r'^CONFIG_(\w+)=', defaults, re.M)
missing = sorted(set(required_configs) - definitions)
if missing:
    raise RuntimeError(f'Unknown sdkconfig defaults: {missing}')
apis = {
    'components/esp_app_format/include/esp_app_desc.h': ['esp_app_get_description'],
    'components/esp_system/include/esp_system.h': ['esp_reset_reason',
                                                 'esp_get_minimum_free_heap_size'],
    'components/esp_common/include/esp_idf_version.h': ['esp_get_idf_version'],
    'components/esp_hw_support/include/esp_chip_info.h': ['esp_chip_info'],
    'components/spi_flash/include/esp_flash.h': ['esp_flash_get_physical_size', 'esp_flash_get_size'],
    'components/esp_psram/include/esp_psram.h': ['esp_psram_is_initialized', 'esp_psram_get_size'],
    'components/heap/include/esp_heap_caps.h': ['heap_caps_malloc', 'heap_caps_free',
                                             'heap_caps_check_integrity_all'],
    'components/esp_timer/include/esp_timer.h': ['esp_timer_get_time'],
    'components/esp_wifi/include/esp_wifi.h': ['esp_wifi_set_storage', 'esp_wifi_set_config',
                                           'esp_wifi_get_config', 'esp_wifi_connect'],
    'components/esp_wifi/include/esp_wifi_default.h': ['esp_netif_create_default_wifi_sta',
                                                   'esp_netif_destroy_default_wifi'],
}
for relative, symbols in apis.items():
    header = (idf / relative).read_text(encoding='utf-8')
    for symbol in symbols:
        if not re.search(rf'\b{symbol}\s*\(', header):
            raise RuntimeError(f'Missing API {symbol} in {relative}')
for name in ['esp_app_format', 'esp_system', 'esp_hw_support', 'esp_psram', 'spi_flash',
             'heap', 'esp_timer', 'esp_wifi', 'esp_event', 'esp_netif', 'nvs_flash', 'freertos']:
    if not (idf / 'components' / name / 'CMakeLists.txt').exists():
        raise RuntimeError(f'Missing IDF component: {name}')
cmake = (source / 'CMakeLists.txt').read_text(encoding='utf-8')
if 'set(COMPONENTS main)' not in cmake or 'EXTRA_COMPONENT_DIRS' in cmake:
    raise RuntimeError('Review M0 isolation from next-stage components')
for path in [source / 'README.md', *(source / 'docs').glob('*.md')]:
    for target in re.findall(r'\]\(([^)]+)\)', path.read_text(encoding='utf-8')):
        if '://' not in target and not (path.parent / target.split('#')[0]).exists():
            raise RuntimeError(f'Broken local link in {path.name}: {target}')
print(f'PASS: SDK 5.3.1 source, {len(required_configs)} config names, API declarations, components and docs')
print('STATIC ONLY: Kconfig resolution, C compilation/linking, packaging and hardware remain unverified')
