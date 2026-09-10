# B860 One-KVM 构建器

中文 | [English](README.md)

预装 [One-KVM](https://github.com/mofeng-git/One-KVM) 的 B860AV1.1-T 开箱即用固件。

## 这是什么

本仓库基于 [b860av1-t-armbian-burn-builder](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder) 构建的 Armbian 基础镜像，集成 One-KVM。产出单个 `burn.img.xz` 可直接刷入 — 开机后访问 `http://<设备IP>:8080` 即可使用 One-KVM。

## 下载

**最新版本：** [Releases](https://github.com/wuhao1477/b860av1-t-one-kvm-builder/releases)

每个 release 包含：
- `burn.img.xz` — 压缩后的 burn 镜像
- `SHA256SUMS` — 校验和文件

## 快速开始

1. 从 releases 下载 `burn.img.xz`
2. 解压：`xz -d burn.img.xz`
3. 使用晶晨烧录工具刷入：
   - 勾选「擦除 flash」和「擦除 bootloader」
   - 选择 `burn.img`
   - 开始刷入
4. 开机后访问 `http://<设备IP>:8080/setup`

默认凭据：`admin` / `admin`

## 包含内容

- **基础系统：** Armbian 26.11.0 (Debian 13 Trixie) + Linux 5.10.268
- **硬件编码：** meson_hcodec V4L2 驱动（`/dev/video0`）
- **One-KVM：** v260802 (arm64)

## 工作原理

1. **基础层**（[b860av1-t-armbian-burn-builder](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder)）构建 Armbian burn 镜像
2. **本层** 解包 burn 镜像，在 rootfs 中安装 One-KVM，重新打包
3. 每周自动检查上游 tag；仅当基础镜像或 One-KVM 发布新版本时才重新构建

无冗余工作 — 完整的 Armbian 构建保留在上游。

## 构建流程

GitHub Actions 工作流：
1. 从 b860av1-t-armbian-burn-builder 下载最新 `burn.img.xz`
2. 下载最新 One-KVM arm64 `.deb`
3. 用 `ampack` 解包 burn 镜像
4. 用 `simg2img` 转换 sparse ext4 rootfs
5. 挂载 rootfs 并用 `qemu-user-static` 进行 `chroot`
6. 安装 One-KVM：`dpkg -i one-kvm.deb && systemctl enable one-kvm`
7. 用 `img2simg` 转回 sparse ext4
8. 用 `ampack` 重新打包
9. 压缩并发布

## 开发

安装镜像工具：
```bash
./scripts/setup-image-tools.sh
```

手动触发工作流：
```bash
gh workflow run build-one-kvm.yml --repo wuhao1477/b860av1-t-one-kvm-builder
```

## 许可证

MIT License - 见 [LICENSE](LICENSE)

## 相关项目

- [b860av1-t-armbian-burn-builder](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder) — Armbian 基础构建
- [One-KVM](https://github.com/mofeng-git/One-KVM) — 基于浏览器的 KVM over IP
