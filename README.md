# B860 One-KVM Builder

开箱即用的 B860AV1.1-T One-KVM 固件构建工具。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

English | [简体中文](README.zh-CN.md)

## 概述

基于以下项目构建 B860AV1.1-T 的 One-KVM 固件：
- [B860 Armbian](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder) — 带 H.264 硬件编码器的基础系统
- [One-KVM](https://github.com/mofeng-git/One-KVM) — IP-KVM 软件

**特性：**
- ✅ One-KVM 预装并启用
- ✅ V4L2 硬件编码器预配置（`/dev/video0`）
- ✅ 刷机即用 — 访问 `http://<设备IP>:8080`

## 本地构建

在 Linux 环境下构建（需要原生 Linux 或 Docker）：

```bash
# 前置依赖
sudo apt-get install -y git curl jq xz-utils nodejs gcc-aarch64-linux-gnu \
  mtools dosfstools e2fsprogs kmod device-tree-compiler

# 安装 GitHub CLI
# 参见: https://github.com/cli/cli#installation

# 克隆并构建
git clone https://github.com/wuhao1477/b860av1-t-one-kvm-builder.git
cd b860av1-t-one-kvm-builder

# 运行构建（下载 B860 Armbian v1.3.0 + One-KVM 最新版，注入并重新打包）
./scripts/build-one-kvm-local.sh

# 输出: output/B860-One-KVM-*.burn.img.xz
```

构建耗时约 20-30 分钟（取决于下载速度和 CPU）。

## 架构

```
输入：B860 Armbian v1.3.0 release
  ↓
克隆 B860 builder 仓库
  ↓
修改 apply-rootfs-defaults.sh（注入 One-KVM）
  ↓
下载 Armbian raw 镜像 + boot-components.json
  ↓
运行 build-burn-payloads.sh（ONE_KVM_DEB 环境变量）
  ↓
运行 build-vendor-boot-burn.sh
  ↓
输出：B860-One-KVM-*.burn.img.xz
```

关键修改：`apply-rootfs-defaults.sh` 读取 `ONE_KVM_DEB` 环境变量并：
1. 解压 One-KVM deb 到 rootfs
2. 启用 systemd 服务
3. 配置 `/etc/one-kvm/encoder.conf` 使用 V4L2 后端

## 刷机

1. 解压 `*.burn.img.xz`
2. 打开 **晶晨 USB 烧录工具**
3. 加载镜像，勾选 **"擦除 flash" + "擦除 bootloader"**
4. B860 进入 USB 烧录模式，开始刷写
5. 访问 One-KVM：`http://<设备IP>:8080`

默认凭据：`admin` / `admin`

## 硬件支持

继承所有 B860 Armbian 硬件支持：
- Amlogic S905L3-B（四核 Cortex-A55，1.8 GHz）
- H.264 硬件编码器（V4L2 M2M，最高 1920x1088）
- 100 Mbps 有线网络、RTL8189FTV Wi-Fi
- 8 GB eMMC、1 GB RAM

详见 [B860 Armbian 文档](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder#hardware-support)。

## 上游项目

- [**B860 Armbian**](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder) — 带硬件编码器的基础系统
- [**One-KVM**](https://github.com/mofeng-git/One-KVM) — IP-KVM 软件
- [**WS1608 One-KVM Builder**](https://github.com/wuhao1477/ws1608-one-kvm-builder) — 类似的 WS1608 构建器

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

包含组件：
- B860 Armbian (MIT)
- One-KVM (GPL-3.0)

完整归属见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 支持

- **问题反馈**：[GitHub Issues](https://github.com/wuhao1477/b860av1-t-one-kvm-builder/issues)
- **上游 B860**：[B860 Armbian Issues](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/issues)
- **上游 One-KVM**：[One-KVM Issues](https://github.com/mofeng-git/One-KVM/issues)

---

⚠️ **免责声明**：刷写自定义固件可能使保修失效。风险自负。
