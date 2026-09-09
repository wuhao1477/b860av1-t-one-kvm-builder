# B860AV1.1-T Armbian

Armbian-based Linux firmware for ZTE ZXV10 B860AV1.1-T set-top box with **hardware-accelerated H.264 encoding/decoding** support.

[![GitHub Release](https://img.shields.io/github/v/release/wuhao1477/b860av1-t-armbian-burn-builder)](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

English | [简体中文](README.zh-CN.md)

## Features

- 🔥 **Ready-to-flash image** for USB Burning Tool — no configuration needed
- 🎥 **H.264 hardware encoder** (`/dev/video0`) — works with FFmpeg, GStreamer, µStreamer
- 📺 **H.264 hardware decoder** — meson-vdec with firmware included
- 🚀 **Fast boot** — 24s to login prompt
- 🔒 **Reproducible builds** — pinned upstream inputs, full source tracking
- 📦 **Debian 13 (Trixie)** — mainline kernel 5.10.268

## Quick Start

### 1. Download

Get the latest release: [**burn.img.xz**](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/releases/latest)

### 2. Flash

1. Extract `burn.img` from the `.xz` archive
2. Open **Amlogic USB Burning Tool**
3. Load `burn.img` and **check both "Erase flash" and "Erase bootloader"**
4. Connect the box in USB boot mode and flash
5. Reboot — login via SSH with `root` / `password`

📖 Detailed flashing guide: [`docs/burn-image.md`](docs/burn-image.md)

### 3. Test hardware encoding

```bash
# Check V4L2 encoder
v4l2-ctl -d /dev/video0 -D

# Encode with FFmpeg
ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30 -frames:v 10 \
  -c:v h264_v4l2m2m -b:v 2M output.mp4

# Encode with GStreamer
gst-launch-1.0 videotestsrc num-buffers=100 ! \
  video/x-raw,width=1280,height=720 ! v4l2h264enc ! \
  h264parse ! mp4mux ! filesink location=test.mp4
```

## Hardware Support

| Component | Status | Notes |
|---|---|---|
| **CPU** | ✅ Amlogic S905L3-B (quad-core Cortex-A55) | 1.8 GHz |
| **H.264 encoder** | ✅ HCODEC (`meson_hcodec.ko`) | V4L2 M2M, up to 1920x1088, Baseline profile |
| **H.264 decoder** | ✅ meson-vdec | Firmware included |
| **Ethernet** | ✅ 100 Mbps | Auto-configured via DHCP |
| **Wi-Fi** | ✅ RTL8189FTV (2.4 GHz) | Requires manual setup |
| **HDMI** | ✅ 1080p output | Console + X11 |
| **eMMC** | ✅ 8 GB | DDR52, 82 MB/s |
| **Bluetooth** | ⚠️ Partial | Initialization timeout, see [known issues](docs/known-issues.md) |

### Verified hardware batch
- Board: `gxl_p211_1g` (P212 DTB, 1 GB RAM)
- Stock U-Boot: matches `config/stock-environment.json`
- Tested on hardware matching SHA256 hashes in `config/burn-inputs.json`

⚠️ Public sources indicate hardware batch variations exist. This firmware is validated only for the specific batch identified by the stock bootloader and board inputs in this repository.

## What's Included

- **No first-boot wizard** — pre-configured root password (`password`), zsh, SSH
- **Auto-expanding root partition** — uses full eMMC capacity on first boot
- **400 MB zram swap** — enabled by default
- **Fast boot** — `NetworkManager-wait-online` disabled
- **V4L2-compliant encoder** — 54/54 `v4l2-compliance` tests pass
- **µStreamer/One-KVM ready** — all required controls (I_PERIOD, LEVEL, PROFILE, REPEAT_SEQ_HEADER) + MPLANE queues

## Documentation

### User guides
- [**Burn image guide**](docs/burn-image.md) — How to flash, boot sequence, troubleshooting
- [**Known issues**](docs/known-issues.md) — Current limitations and workarounds

### Hardware & drivers
- [**Hardware encoder**](docs/hcodec-encoder-plan.md) — V4L2 driver design, capabilities, limitations
- [**Hardware probes**](docs/hardware-probes.md) — HCODEC block verification via `/dev/mem`

### Development
- [**Build system**](docs/technical/build-details.md) — Two-line architecture, frozen inputs, presets
- [**Version history**](docs/technical/version-history.md) — Release notes and changelog
- [**Frozen inputs**](docs/frozen-inputs.md) — Why inputs are pinned, how to update
- [**Device validation**](docs/device-validation.md) — Evidence collection process

## Releases

| Version | Status | Description |
|---|---|---|
| **v1.3.0** | ✅ Latest | µStreamer/One-KVM support + V4L2 full compliance (54/54) |
| v1.2.0 | ✅ Verified | H.264 hardware encoder + decoder |
| v1.1.0 | ✅ Verified | H.264 hardware decoder only |
| v1.0.0 | ✅ Verified | Base system without hardware video |

All `v1.x.x` releases are hardware-verified on physical devices.

## Development

### Build locally

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get install -y nodejs npm p7zip-full python3

# Clone and setup
git clone https://github.com/wuhao1477/b860av1-t-armbian-burn-builder.git
cd b860av1-t-armbian-burn-builder
npm install

# Build burn image
./scripts/build-vendor-boot-burn.sh
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for detailed development workflow.

### Architecture

```
Input: Armbian raw image (frozen at build-46.1)
  ↓
scripts/build-burn-payloads.sh → extract boot/rootfs, apply defaults
  ↓
scripts/apply-rootfs-defaults.sh → inject meson_hcodec.ko, vdec firmware, presets
  ↓
scripts/build-vendor-boot-burn.sh → pack Android boot + BL2 + sparse ext4
  ↓
Output: burn.img (flashable with USB Burning Tool)
```

Key files:
- `tools/hcodec-mod/meson_hcodec.c` — V4L2 M2M encoder driver (out-of-tree)
- `board-inputs/` — Stock bootloader fragments (BL2, BL30, BL301, BL33)
- `config/burn-inputs.json` — SHA256 whitelist for vendor binaries

## License

MIT License — see [LICENSE](LICENSE) for details.

Incorporates materials from:
- [ophub/amlogic-s9xxx-armbian](https://github.com/ophub/amlogic-s9xxx-armbian) (GPL-2.0)
- [LibreELEC firmware binaries](https://github.com/LibreELEC/LibreELEC.tv) (various licenses)
- Stock ZTE bootloader components (vendor binaries, redistribution for device owners)

See [THIRD_PARTY_SOURCES.md](THIRD_PARTY_SOURCES.md) for complete attribution.

## Contributing

Contributions welcome! Please:
1. Read [`CONTRIBUTING.md`](CONTRIBUTING.md)
2. Test on real hardware
3. Document changes in PR description
4. Follow existing code style

## Support

- **Issues**: [GitHub Issues](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/issues)
- **Discussions**: [GitHub Discussions](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/discussions)

---

⚠️ **Disclaimer**: Flashing custom firmware may void warranty. Use at your own risk.
