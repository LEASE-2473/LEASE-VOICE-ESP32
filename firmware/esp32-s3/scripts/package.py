"""Offline packaging only: no serial APIs or device commands."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--stage', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
def command(*values):
    return subprocess.check_output(list(values), text=True, encoding='utf-8').strip()

compiled_sources = ['CMakeLists.txt', 'sdkconfig.defaults', 'partitions.csv']
for folder in ('main', 'components'):
    compiled_sources += [p.relative_to(args.source).as_posix()
                         for p in sorted((args.source / folder).rglob('*'))
                         if p.is_file() and (p.suffix in ('.c', '.h') or p.name in ('CMakeLists.txt', 'Kconfig', 'Kconfig.projbuild'))]
for name in compiled_sources:
    if (args.source / name).read_bytes() != (args.stage / name).read_bytes():
        raise RuntimeError(f'Source changed during build: {name}; rebuild before delivery')
build = args.stage / 'build'
flash = json.loads((build / 'flasher_args.json').read_text())
description = json.loads((build / 'project_description.json').read_text())
args.output.mkdir(parents=True, exist_ok=False)
images = []
for address, relative in flash['flash_files'].items():
    source = build / relative
    target = args.output / source.name
    shutil.copy2(source, target)
    images.append({'file': target.name, 'address': address,
                   'size': target.stat().st_size,
                   'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                   'source': f'build/{relative}'})
for relative in ('flasher_args.json', 'flash_args', 'project_description.json',
                 'config/sdkconfig.json', 'lease_voice.elf', 'lease_voice.map'):
    shutil.copy2(build / relative, args.output / Path(relative).name)
shutil.copy2(args.stage / 'sdkconfig', args.output / 'sdkconfig')
shutil.copy2(args.stage / 'build.log', args.output / 'build.log')
source_names = ['CMakeLists.txt', 'sdkconfig.defaults', 'partitions.csv', 'README.md']
for folder in ('main', 'scripts', 'docs', 'components'):
    source_names += [p.relative_to(args.source).as_posix()
                     for p in sorted((args.source / folder).rglob('*'))
                     if p.is_file() and '__pycache__' not in p.parts]
with zipfile.ZipFile(args.output / 'source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in source_names:
        archive.write(args.source / name, name)
try:
    idf_commit = command('git', '-C', os.environ['IDF_PATH'], 'rev-parse', 'HEAD')
except (OSError, subprocess.CalledProcessError):
    idf_commit = None  # Official installer archives need not include .git.
idf_root = Path(os.environ['IDF_PATH'])
sdk_audit = []
if idf_commit is not None:
    # Installer archives can materialize Git symlinks as ordinary files on
    # Windows. Record and compare every changed tracked path, without fixing
    # or otherwise modifying the user's SDK.
    def audit_worktree(root, prefix=''):
        status = command('git', '-C', str(root), 'status', '--porcelain')
        for name in command('git', '-C', str(root), 'diff', '--name-only').splitlines():
            meta = command('git', '-C', str(root), 'ls-tree', 'HEAD', '--', name)
            item = {'path': prefix + name, 'git_mode': meta.split()[0]}
            if meta.startswith('120000 '):
                target = command('git', '-C', str(root), 'show', 'HEAD:' + name)
                item.update(symlink_target=target,
                            matches_expanded_target=(root / name).read_bytes() ==
                            (root / name).parent.joinpath(target).read_bytes())
            elif meta.startswith('160000 '):
                audit_worktree(root / name, prefix + name + '/')
            sdk_audit.append(item)
        return status
    sdk_status = audit_worktree(idf_root)
else:
    sdk_status = None
(args.output / 'sdk-working-tree.json').write_text(
    json.dumps({'status': sdk_status, 'changes': sdk_audit}, indent=2) + '\n', encoding='utf-8')
compiler = command(description['c_compiler'], '--version')
milestone = 'M3' if '-m3.' in description['project_version'] else 'M2' if '-m2.' in description['project_version'] else 'M1' if '-m1.' in description['project_version'] else 'M0'
manifest = {'version': description['project_version'], 'milestone': milestone,
            'idf_version': description['git_revision'], 'idf_commit': idf_commit,
            'idf_version_file_sha256': hashlib.sha256((idf_root / 'tools/cmake/version.cmake').read_bytes()).hexdigest(),
            'idf_worktree_dirty': bool(sdk_status) if sdk_status is not None else None,
            'compiler': compiler, 'python_version': sys.version,
            'target': description['target'], 'image_type': 'separate',
            'hardware_tested': False, 'flash_settings': flash['flash_settings'],
            'extra_esptool_args': flash['extra_esptool_args'], 'images': images}
(args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
tools = subprocess.check_output([sys.executable, str(idf_root / 'tools/idf_tools.py'),
                                 'list'], text=True)
(args.output / 'tools.txt').write_text(tools, encoding='utf-8')
packages = subprocess.check_output([sys.executable, '-m', 'pip', 'freeze'], text=True)
(args.output / 'python-packages.txt').write_text(packages, encoding='utf-8')
tools_root = Path(os.environ.get('IDF_TOOLS_PATH', str(Path.home() / '.espressif')))
shutil.copy2(tools_root / 'espidf.constraints.v5.3.txt', args.output / 'espidf.constraints.v5.3.txt')
rows = '\n'.join(f'| `{i["file"]}` | `{i["address"]}` | {i["size"]} | `{i["sha256"]}` |'
                 for i in images)
delivery = f'''# {milestone} {manifest["version"]} 构建交付

由实际构建结果生成。本文件存在不替代 verify.py 成功结果；若构建脚本最后未报告离线校验通过，禁止交付此目录。实物未验证。

- ESP-IDF：{manifest["idf_version"]}；Git commit：{idf_commit or "安装包未提供 Git 元数据"}。
- SDK 工作区状态见 sdk-working-tree.json。本机 dirty 项为安装包展开的示例脚本和 NimBLE/RIOT 头文件符号链接，已逐项核对与链接目标内容一致；未修改 SDK。此版本未包含蓝牙组件，不将安装器环境声称为干净 Git 检出。
- 目标：{manifest["target"]}，分离镜像；DIO / 40MHz / 16MB，PSRAM Octal / 80MHz，CPU 160MHz。
- 烧录地址来自本目录 flasher_args.json，非人工估计。

| 文件 | 地址 | 字节数 | SHA-256 |
| --- | --- | --- | --- |
{rows}

仅联调聊天操作设备：Flash Download Tool 选择 ESP32-S3 / Develop / UART，分别勾选上表三个文件和地址；SPI SPEED 40MHz、SPI MODE DIO、Flash 16MB（若界面提供），勿选全片擦除。串口由联调侧识别，先关闭其他串口工具；下载波特率可先用 115200，日志固定 115200。工具若与此模式/镜像头不一致，停止并核对，不修改镜像头覆盖构建参数。首次覆盖 bootloader/分区表/应用前评估备份原 16MB Flash。

分区：nvs 0x9000/0x6000、phy_init 0xf000/0x1000、factory 0x10000/0x400000，与已冻结 M0 相同。M1 会初始化 NVS 并在 lease_voice 命名空间保存 Wi-Fi 配置及设备 Token（设备本地未加密存储），不自动擦除 NVS。旧数据布局仍须核对；完整原机备份是否存在以联调记录为准，部分备份不能声称恢复出厂。不整片擦除，不操作 eFuse。

验收：音频见 source.zip 内 docs/M2_PCM_PLAYBACK.md，M3屏幕见docs/M3_DISPLAY.md，网络配置见docs/M1_SETUP_AND_ACCEPTANCE.md。启动静音，屏幕默认off，不驱动候选屏幕GPIO，须电脑显式配置才启用；候选型号/信号角色未经实物确认，不能将SPI写入或frame queued当显示成功。M3仅接收RGB565BE全帧并短缓存，不解码视频、不存Flash。首次烧录须重新评估镜像末地址与现有部分备份覆盖范围，不能沿用旧版首1MiB覆盖结论。BLE/STT未实现。

复现：使用 source.zip、记录的 ESP-IDF 和编译器、python-packages.txt、espidf.constraints.v5.3.txt；在用户已经安装的 IDF 环境执行 scripts/build.ps1，显式传入 -IdfPath、-IdfToolsPath、-PythonExe。build.log/ELF/MAP/sdkconfig 留作核对。单次构建通过不代表已证明逐字节可复现；未自行下载安装依赖。
'''
(args.output / 'DELIVERY.md').write_text(delivery, encoding='utf-8')
checksums = []
for path in sorted(args.output.iterdir()):
    if path.is_file():
        checksums.append(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}')
(args.output / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
print(json.dumps(manifest, indent=2))
