# B860AV1.1-T Armbian

基于 Armbian 的中兴 ZXV10 B860AV1.1-T 机顶盒 Linux 固件，支持 **H.264 硬件编解码**。

[![GitHub Release](https://img.shields.io/github/v/release/wuhao1477/b860av1-t-armbian-burn-builder)](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | 简体中文

## 特性

- 🔥 **开箱即用镜像** — USB Burning Tool 直刷，无需配置
- 🎥 **H.264 硬件编码** (`/dev/video0`) — FFmpeg、GStreamer、µStreamer 零补丁支持
- 📺 **H.264 硬件解码** — meson-vdec 驱动，固件已内置
- 🚀 **快速启动** — 24 秒到登录提示符
- 🔒 **可复现构建** — 上游输入冻结，完整源码追溯
- 📦 **Debian 13 (Trixie)** — 主线内核 5.10.268

## 快速开始

### 1. 下载

获取最新版本：[**burn.img.xz**](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/releases/latest)

### 2. 刷机

1. 解压 `.xz` 文件得到 `burn.img`
2. 打开 **晶晨 USB 烧录工具**（Amlogic USB Burning Tool）
3. 加载 `burn.img`，**勾选"擦除 flash"和"擦除 bootloader"**
4. 盒子进入 USB 烧录模式，连接电脑开始刷写
5. 重启 — 通过 SSH 登录（用户名 `root`，密码 `password`）

📖 详细刷机教程：[`docs/burn-image.md`](docs/burn-image.md)

### 3. 测试硬件编码

```bash
# 检查 V4L2 编码器
v4l2-ctl -d /dev/video0 -D

# 使用 FFmpeg 编码
ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30 -frames:v 10 \
  -c:v h264_v4l2m2m -b:v 2M output.mp4

# 使用 GStreamer 编码
gst-launch-1.0 videotestsrc num-buffers=100 ! \
  video/x-raw,width=1280,height=720 ! v4l2h264enc ! \
  h264parse ! mp4mux ! filesink location=test.mp4
```

## 硬件支持

| 组件 | 状态 | 说明 |
|---|---|---|
| **CPU** | ✅ Amlogic S905L3-B (四核 Cortex-A55) | 1.8 GHz |
| **H.264 编码** | ✅ HCODEC (`meson_hcodec.ko`) | V4L2 M2M，最高 1920x1088，Baseline profile |
| **H.264 解码** | ✅ meson-vdec | 固件已内置 |
| **有线网络** | ✅ 100 Mbps | DHCP 自动配置 |
| **Wi-Fi** | ✅ RTL8189FTV (2.4 GHz) | 需手动配置 |
| **HDMI** | ✅ 1080p 输出 | 控制台 + X11 |
| **eMMC** | ✅ 8 GB | DDR52, 82 MB/s |
| **蓝牙** | ⚠️ 部分支持 | 初始化超时，见[已知问题](docs/known-issues.md) |

### 已验证硬件批次
- 主板型号：`gxl_p211_1g`（P212 DTB，1 GB RAM）
- 原厂 U-Boot：与 `config/stock-environment.json` 匹配
- 仅在与本仓库原厂输入 SHA256 匹配的硬件批次上测试通过

⚠️ 公开资料表明该型号存在硬件批次差异。本固件仅在与仓库中原厂 bootloader 和板级输入一致的特定批次上验证通过。

## 预置内容

- **无首次开机向导** — 预配置 root 密码（`password`）、zsh、SSH
- **自动扩展根分区** — 首次启动自动使用完整 eMMC 容量
- **400 MB zram 交换分区** — 默认启用
- **快速启动** — 禁用 `NetworkManager-wait-online`
- **V4L2 全兼容编码器** — 通过 54/54 项 `v4l2-compliance` 测试
- **µStreamer/One-KVM 就绪** — 包含所有必需控件（I_PERIOD、LEVEL、PROFILE、REPEAT_SEQ_HEADER）+ MPLANE 队列

## 文档

### 用户指南
- [**刷机指南**](docs/burn-image.md) — 刷机方法、启动流程、故障排查
- [**已知问题**](docs/known-issues.md) — 当前限制与解决方案

### 硬件与驱动
- [**硬件编码器**](docs/hcodec-encoder-plan.md) — V4L2 驱动设计、功能、限制
- [**硬件探测**](docs/hardware-probes.md) — 通过 `/dev/mem` 验证 HCODEC 模块

### 开发
- [**构建系统**](docs/technical/build-details.md) — 双线构建架构、冻结输入、预置项
- [**版本历史**](docs/technical/version-history.md) — 发布说明与变更日志
- [**冻结输入**](docs/frozen-inputs.md) — 为什么冻结输入、如何更新
- [**设备验证**](docs/device-validation.md) — 证据采集流程

## 版本发布

| 版本 | 状态 | 说明 |
|---|---|---|
| **v1.3.0** | ✅ 最新 | µStreamer/One-KVM 支持 + V4L2 全兼容（54/54） |
| v1.2.0 | ✅ 已验证 | H.264 硬件编码 + 解码 |
| v1.1.0 | ✅ 已验证 | 仅 H.264 硬件解码 |
| v1.0.0 | ✅ 已验证 | 基础系统，不含硬件视频 |

所有 `v1.x.x` 版本均已在实机上验证通过。

## 开发

### 本地构建

```bash
# 安装依赖（Ubuntu/Debian）
sudo apt-get install -y nodejs npm p7zip-full python3

# 克隆并设置
git clone https://github.com/wuhao1477/b860av1-t-armbian-burn-builder.git
cd b860av1-t-armbian-burn-builder
npm install

# 构建 burn 镜像
./scripts/build-vendor-boot-burn.sh
```

详细开发流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

### 架构

```
输入：Armbian raw 镜像（冻结在 build-46.1）
  ↓
scripts/build-burn-payloads.sh → 提取 boot/rootfs，应用默认配置
  ↓
scripts/apply-rootfs-defaults.sh → 注入 meson_hcodec.ko、vdec 固件、预置项
  ↓
scripts/build-vendor-boot-burn.sh → 打包 Android boot + BL2 + sparse ext4
  ↓
输出：burn.img（可用 USB Burning Tool 刷写）
```

关键文件：
- `tools/hcodec-mod/meson_hcodec.c` — V4L2 M2M 编码器驱动（树外模块）
- `board-inputs/` — 原厂 bootloader 片段（BL2、BL30、BL301、BL33）
- `config/burn-inputs.json` — 厂商二进制文件 SHA256 白名单

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

包含以下项目的材料：
- [ophub/amlogic-s9xxx-armbian](https://github.com/ophub/amlogic-s9xxx-armbian) (GPL-2.0)
- [LibreELEC 固件二进制文件](https://github.com/LibreELEC/LibreELEC.tv)（多种许可证）
- 中兴原厂 bootloader 组件（厂商二进制文件，供设备所有者再分发）

完整归属见 [THIRD_PARTY_SOURCES.md](THIRD_PARTY_SOURCES.md)。

## 贡献

欢迎贡献！请：
1. 阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)
2. 在真实硬件上测试
3. 在 PR 描述中记录变更
4. 遵循现有代码风格

## 支持

- **问题反馈**：[GitHub Issues](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/issues)
- **讨论交流**：[GitHub Discussions](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/discussions)

---

⚠️ **免责声明**：刷写自定义固件可能使保修失效。风险自负。
