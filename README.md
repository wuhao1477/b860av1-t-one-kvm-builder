# B860 One-KVM Builder

[中文](README.zh-CN.md) | English

Ready-to-flash B860AV1.1-T firmware with [One-KVM](https://github.com/mofeng-git/One-KVM) pre-installed.

## What This Is

This repository builds on top of [b860av1-t-armbian-burn-builder](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder) by integrating One-KVM into the base Armbian image. The result is a single `burn.img.xz` you can flash directly — boot once and access One-KVM at `http://<device-ip>:8080`.

## Download

**Latest Release:** [Releases](https://github.com/wuhao1477/b860av1-t-one-kvm-builder/releases)

Each release includes:
- `burn.img.xz` — compressed burn image
- `SHA256SUMS` — checksum file

## Quick Start

1. Download `burn.img.xz` from releases
2. Extract: `xz -d burn.img.xz`
3. Flash with Amlogic USB Burning Tool:
   - Enable "Erase flash" and "Erase bootloader"
   - Select `burn.img`
   - Flash
4. Boot device and open `http://<device-ip>:8080/setup`

Default credentials: `admin` / `admin`

## What's Included

- **Base:** Armbian 26.11.0 (Debian 13 Trixie) with Linux 5.10.268
- **Encoder:** meson_hcodec V4L2 driver (`/dev/video0`)
- **One-KVM:** v260802 (arm64)

## How It Works

1. **Base layer** ([b860av1-t-armbian-burn-builder](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder)) builds the Armbian burn image
2. **This layer** unpacks the burn image, installs One-KVM into the rootfs, and repacks
3. Automated weekly checks track upstream tags; rebuilds only when either base or One-KVM releases a new version

No redundant work — the full Armbian build stays upstream.

## Build Process

GitHub Actions workflow:
1. Download latest `burn.img.xz` from b860av1-t-armbian-burn-builder
2. Download latest One-KVM arm64 `.deb`
3. Unpack burn image with `ampack`
4. Convert sparse ext4 rootfs with `simg2img`
5. Mount rootfs and `chroot` with `qemu-user-static`
6. Install One-KVM: `dpkg -i one-kvm.deb && systemctl enable one-kvm`
7. Convert back to sparse ext4 with `img2simg`
8. Repack with `ampack`
9. Compress and publish

## Development

Setup image tools:
```bash
./scripts/setup-image-tools.sh
```

Manual workflow trigger:
```bash
gh workflow run build-one-kvm.yml --repo wuhao1477/b860av1-t-one-kvm-builder
```

## License

MIT License - see [LICENSE](LICENSE)

## Related Projects

- [b860av1-t-armbian-burn-builder](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder) — Base Armbian build
- [One-KVM](https://github.com/mofeng-git/One-KVM) — Browser-based KVM over IP
