# Version History

## Release policy

- **`v1.x.x` (latest)**: Hardware-verified releases — every byte tested on physical hardware
- **`armbian-*-build-N.M`**: Weekly raw image builds — container + filesystem validation only
- **`b860-burn-*-build-N.M`**: Weekly burn image builds — same strategy as verified releases, but NOT hardware-tested

**Only download `latest` for flashing.** All other tags are either build artifacts or legacy versions.

## v1.3.0 (2026-09-09) — Latest

**µStreamer / One-KVM support + V4L2 full compliance**

### Added
- µStreamer / One-KVM required driver features:
  - `V4L2_CID_MPEG_VIDEO_H264_I_PERIOD` — GOP configuration
  - `V4L2_CID_MPEG_VIDEO_H264_LEVEL` — menu (4.0/4.1/4.2/5.0/5.1)
  - `V4L2_CID_MPEG_VIDEO_REPEAT_SEQ_HEADER` — forced to 1 (SPS/PPS in every IDR)
  - `V4L2_CID_MPEG_VIDEO_H264_PROFILE` — menu with Constrained Baseline as default
  - MPLANE queues (`VIDEO_{OUTPUT,CAPTURE}_MPLANE`, reports `V4L2_CAP_VIDEO_M2M_MPLANE`)

### Fixed
- V4L2 compliance: **54/54 tests pass** (was 51/54)
  - `field` normalization (output buffers no longer `FIELD_ANY`)
  - `sequence` per-frame increment (`v4l2_m2m_buf_copy_metadata()` does not copy this field)
  - Drain completion flag (`V4L2_BUF_FLAG_LAST` on final output buffer)
  - `hc_poll` unconditionally wakes `done_wq` (epoll now works)

### Verified
- Hardware test: all four new controls present, MPLANE capability `0x04204000`
- 1280x768 NV12 10-frame encoding successful, GOP structure correct
- µStreamer's `_m2m_encoder_prepare()` no longer destroys encoder due to missing controls

### Compatibility
- Supports µStreamer (pikvm/ustreamer) out of the box
- Ready for One-KVM streaming development

**Commits**: `42e299f..a71ab3e` (compressed history)

---

## v1.2.0 (2026-09-06)

**Burn image + H.264 hardware decoder + hardware encoder**

### Added
- H.264 hardware encoder driver (`meson_hcodec.ko`)
  - V4L2 M2M interface at `/dev/video0`
  - FFmpeg (`h264_v4l2m2m`) / GStreamer (`v4l2h264enc`) zero-patch support
  - 1280x768 10-frame GOP encoding: 40.4~41.8 dB PSNR
  - Auto-recovery from ucode hangs (raises QP and retries)
  
### Verified
- Hardware test: encoder module loaded, 1280x720 encoding successful
- Eight presets verified (added encoder to v1.1.0's seven presets)

### Known limitations
- Mainline 5.10 has decoder only; encoder hardware was previously undocumented
- Ucode may hang on expensive macroblocks; driver auto-recovers
- See [`docs/hcodec-encoder-plan.md`](../hcodec-encoder-plan.md) for implementation details

**Commits**: `c041e7c..9a4c243` (compressed history)

---

## v1.1.0 (2026-09-05)

**Burn image + H.264 hardware decoder**

### Added
- H.264 hardware decoder support (`meson-vdec`)
- Decoder firmware installed to `/lib/firmware/meson/vdec/`
- Fixes upstream `VIDIOC_STREAMON` `-EINVAL` error (firmware directory missing entirely)

### Verified
- Hardware test: H.264 decoding functional
- Seven presets verified (all v1.0.0 presets + hardware decoder)
- Build `build-50.1` byte-for-byte identical to this release

### Fixed
- Upstream Armbian raw image ships without vdec firmware directory
- See [`docs/known-issues.md`](../known-issues.md) #10

**Commits**: `da2cf40..c041e7c` (compressed history)

---

## v1.0.0 (2026-09-04)

**Initial burn image release (Variant C, hardware verified)**

### Features
- ZTE ZXV10 B860AV1.1-T burn image for USB Burning Tool
- Armbian 26.11.0 / Debian 13.6 (Trixie)
- Kernel 5.10.268-ophub
- Six presets verified on hardware:
  - `root` / `password` direct SSH (no first-boot wizard)
  - zsh 5.9 + oh-my-zsh
  - Auto-expanding root partition (2.9G → 5.1G on 8GB eMMC)
  - zram 400 MB swap
  - Fast boot (24.3s, NetworkManager-wait-online disabled)
  - eMMC DDR52 82 MB/s

### Verified
- Hardware test: flashed 2026-09-03, system boots, all six presets functional
- Re-verified 2026-09-04 (second flash)
- Build `build-49.1` byte-for-byte identical to this release

### Known issues
- `/boot` empty (kernel in rootfs `/boot/` instead)
- Bluetooth initialization timeout
- 5.10 kernel EOL 2026-12-31
- See [`docs/known-issues.md`](../known-issues.md)

**Commits**: Initial to `da2cf40` (compressed history)

---

## Variant A / B (discredited)

Early experimental variants that failed hardware verification:
- **Variant A**: Ophub BL33 + rootfs `/boot` — black screen, no HDMI output
- **Variant B**: Vendor FIP + Android boot — boot loop, never reached system

Root cause analysis in [`docs/burn-image.md`](../burn-image.md).

Only **Variant C** (vendor BL33 + Android boot + rootfs extraction) passed all hardware tests.

---

## Weekly builds

| Tag pattern | Type | Hardware tested | Safe to flash |
|---|---|---|---|
| `v1.x.x` | Release | ✅ Yes | ✅ **Recommended** |
| `b860-burn-*-build-N.M` | Weekly burn image | ❌ No (except build-50.1 = v1.1.0, build-52.1 = v1.2.0) | ⚠️ Use at own risk |
| `armbian-*-build-N.M` | Weekly raw image | ❌ No | ❌ Cannot direct-flash |
| `input-armbian-*` | Frozen input | N/A (build material) | ❌ Not a flashable image |

Weekly builds use the same construction strategy as verified releases, but the output bytes have NOT been tested on hardware.

Earlier incomplete prerelease builds (`build-43.1` through `build-49.1`, except `build-49.1` which became `v1.0.0`) have been deleted to prevent accidental flashing. Each `v1.x.x` release documents its equivalent build number for SHA256 traceability.

---

## System information (v1.3.0)

```
Armbian OS 26.11.0 trixie / Debian GNU/Linux 13
Linux 5.10.268-ophub aarch64        BOARD="B860av1-T"
wlan0  RTL8189FTV (8189fs) 2.4G 20 Mbps   eth0 100Mbps/Full DHCP
HDMI   card0-HDMI-A-1 connected     eMMC DDR52 82 MB/s (/dev/mmcblk2p14 ext4)
```

Hardware decoder: ✅ meson-vdec with firmware  
Hardware encoder: ✅ meson_hcodec V4L2 M2M (54/54 compliance)  
µStreamer ready: ✅ All required controls + MPLANE queues
