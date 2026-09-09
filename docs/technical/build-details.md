# Build System Details

## Two-line build system

This repository maintains two separate build pipelines:

| Pipeline | Output | Workflow | Status |
|---|---|---|---|
| **Burn image** | `b860-burn-*` releases (`burn.img.xz`) | [`weekly-burn-build.yml`](../../.github/workflows/weekly-burn-build.yml) | Active, frozen inputs |
| **Raw image** | `armbian-*` prereleases (input source for burn images) | [`weekly-build.yml`](../../.github/workflows/weekly-build.yml) | Active, tracking upstream |

The burn image pipeline uses **frozen inputs**: the exact raw image that passed hardware verification is mirrored at [`input-armbian-26.11.0-debian-13.6-trixie-k5.10.268-build-46.1`](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/releases/tag/input-armbian-26.11.0-debian-13.6-trixie-k5.10.268-build-46.1) with matching `SOURCE_DIGEST`.

## Frozen inputs

Burn image builds use pinned sources defined at the top of `weekly-burn-build.yml`:
- `SOURCE_REPOSITORY` / `SOURCE_RELEASE` / `SOURCE_ASSET` / `SOURCE_DIGEST`
- Kernel pinned at `5.10.268` in `config/sources.json` with SHA256 verification

If upstream inputs change, CI fails — it will never silently produce an untested build. To update frozen inputs, see [`frozen-inputs.md`](../frozen-inputs.md).

Raw builds continue to run weekly but their output does NOT automatically become burn image input.

## Build process

```
1. Download frozen raw image → verify SHA256
2. Extract boot + rootfs → scripts/build-burn-payloads.sh
3. Apply rootfs defaults → scripts/apply-rootfs-defaults.sh
   - Install meson_hcodec.ko + vdec firmware
   - Set root password hash
   - Configure zsh + oh-my-zsh
   - Enable zram swap (drop-in)
   - Disable NetworkManager-wait-online
4. Pack Android boot → scripts/build-vendor-boot-burn.sh
   - Combine vendor BL2/BL30/BL301/BL33 from board-inputs/
   - Create sparse ext4 for data partition
   - Assemble burn.img with platform.conf
5. Validate → scripts/validate-vendor-boot-burn.sh
   - Check boot contract (cmdline, root UUID)
   - Check DTB contract (7 sub-DTB slots)
   - Verify SHA256SUMS
```

## Key files

### Build scripts
- `scripts/build-burn-payloads.sh` — Extract boot/data payloads from raw image
- `scripts/apply-rootfs-defaults.sh` — Pre-configure rootfs (password, shell, drivers)
- `scripts/fetch-vdec-firmware.sh` — Download vdec firmware with pinned commit + SHA256
- `scripts/build-vendor-boot-burn.sh` — Build variant C (only hardware-verified variant)
- `scripts/validate-vendor-boot-burn.sh` — Independent verification of deliverables
- `scripts/setup-image-tools.sh` — Build ampack/gxlimg from pinned commits
- `scripts/burn-image.mjs` — Android boot packing, BL2 digest, sparse ext4 primitives

### Configuration
- `board-inputs/` — Stock firmware fragments (required build inputs)
- `config/burn-inputs.json` — SHA256 whitelist for vendor binaries
- `config/stock-environment.json` — 81 stock U-Boot environment variables snapshot
- `config/sources.json` — Pinned kernel version + SHA256

### Driver source
- `tools/hcodec-mod/meson_hcodec.c` — V4L2 M2M encoder driver (out-of-tree module)
- `tools/hcodec-mod/kmshim.h` — Kernel shim for 5.10 compatibility

## Rootfs presets

Applied by `scripts/apply-rootfs-defaults.sh` during build:

| Preset | Value | Why |
|---|---|---|
| **Login** | `root` / `password` | No first-boot wizard; direct SSH access |
| **Password hash** | `$6$b860burn$21d1hZz5...` | Pinned in `/etc/shadow` (generated with `openssl passwd -6 -salt b860burn password`) |
| **Shell** | zsh 5.9 + oh-my-zsh | Change via `root_shell` variable |
| **Root partition** | Auto-expand on first boot | `resize2fs` expands to full eMMC (2.9G → 5.1G on 8GB) |
| **Swap** | zram 400 MB | `armbian-zram-config` via `sysinit.target.d` drop-in |
| **Boot time** | `NetworkManager-wait-online` disabled | 24.3s to login (30.6s first boot with resize) |
| **H.264 decoder** | `meson-vdec` firmware in `/lib/firmware/meson/vdec/` | Required for `VIDIOC_STREAMON` (absent in upstream image) |
| **H.264 encoder** | `meson_hcodec.ko` in `/lib/modules/<release>/extra/` | Auto-loads with `stage=1 selftest=0` |

### Why drop-ins for zram?

Initial attempts to create `.wants` symlinks during build failed: symlinks written at the same millisecond as regular files disappeared from the image, while regular files persisted. Root cause unknown, but drop-ins (`/etc/systemd/system/sysinit.target.d/`) work reliably and have been verified across three hardware reboots. See [`known-issues.md`](../known-issues.md) #7-8.

### WiFi passwords

WiFi credentials are NOT stored in the repository (CI artifacts are public). To pre-configure WiFi, create `board-inputs/wifi.env` locally:

```bash
WIFI_SSID=your-network
WIFI_PSK=your-password
```

Then rebuild locally. See [`known-issues.md`](../known-issues.md) #7.

## Release schemas

Two independent versioned schemas (do not confuse):

| Schema | File | Current version | Authority |
|---|---|---|---|
| **Source manifest** | `resolved-sources.json` | 5 | [`config/sources.json`](../../config/sources.json) |
| **Validation report** | `validation-report.json` | 8 | `CURRENT_VALIDATION_SCHEMA` in [`src/change-detection.mjs`](../../src/change-detection.mjs) |

## Change detection

Weekly builds only proceed if the unified fingerprint changes:
- Fingerprint includes all resolved source URLs, SHAs, and config hashes
- If unchanged, only lightweight detection jobs run
- If changed, full build + validation runs
- Build failures do NOT record as success — next week retries the same inputs

Successful builds create a prerelease with:
- `resolved-sources.json` — exact source versions used
- `validation-report.json` — container + filesystem checks
- `boot-components.json` / `uboot-build.json` / `source-built-dtb.json`
- Device tree source (`device-tree-source.dts`)
- QEMU smoke test results (`qemu-system-smoke.json` + `.log`)
- Driver builds (`rtl8189fs-driver.json`)
- Hardware capabilities (`hardware-capabilities.json`)
- Full U-Boot source with patches (`u-boot-source.tar.gz`)
- Third-party sources list ([`THIRD_PARTY_SOURCES.md`](../../THIRD_PARTY_SOURCES.md))
- Filesystem manifest (`filesystem-manifest.sha256`)
- `SHA256SUMS`

Tag format: `armbian-<version>-debian-<debian-full>-<codename>-k<kernel>-build-<run>.<retry>`

Same version can be rebuilt multiple times without overwriting history.

## GitHub Actions maintenance

Every ~42 days, `.github/schedule-heartbeat` is updated to prevent GitHub from disabling the schedule (60-day inactivity threshold). This file does NOT enter the build fingerprint and does NOT trigger CI compilation or image builds when changed alone.

## Hardware batch identification

Public sources indicate hardware batch variations exist for this model. The stock BL33 in this repository explicitly selects `gxl_p211_1g`; Linux uses P212 DTB with 1 GB RAM. This configuration applies only to B860AV1.1-T batches matching the stock bootloader fingerprint and vendor input SHA256s in `config/burn-inputs.json`.

The raw image line's DTB is built from public P212 sources with corrections; while builds verify RTL8189FTV, SDIO 200 MHz, reset GPIO, and 64 MiB CMA, the upstream root node model remains generic P212. Since this combination lacks complete boot records, raw releases are candidate images, not confirmed bootable firmware.
