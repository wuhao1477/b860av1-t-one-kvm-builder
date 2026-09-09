# B860 One-KVM Builder

B860AV1.1-T One-KVM 一键安装工具。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](#english) | [简体中文](#简体中文)

---

## 简体中文

### 快速开始（推荐）

**前提**：已刷入 [B860 Armbian v1.3.0](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/releases/tag/v1.3.0)

在 B860 设备上运行一键安装脚本：

```bash
# SSH 登录 B860（默认密码：password）
ssh root@<B860-IP>

# 下载并运行安装脚本
curl -fsSL https://raw.githubusercontent.com/wuhao1477/b860av1-t-one-kvm-builder/main/install-one-kvm.sh | bash

# 或者分步执行
wget https://raw.githubusercontent.com/wuhao1477/b860av1-t-one-kvm-builder/main/install-one-kvm.sh
chmod +x install-one-kvm.sh
./install-one-kvm.sh
```

安装完成后访问：`http://<B860-IP>:8080`（默认凭据：`admin` / `admin`）

### 手动安装

```bash
# 1. 下载 One-KVM
wget https://github.com/mofeng-git/One-KVM/releases/download/v260802/one-kvm_0.2.6_armhf.deb

# 2. 安装
apt-get update
apt-get install -y ./one-kvm_0.2.6_armhf.deb

# 3. 配置硬件编码器
mkdir -p /etc/one-kvm
cat > /etc/one-kvm/encoder.conf << 'CONF'
backend=v4l2m2m
device=/dev/video0
CONF

# 4. 启动服务
systemctl enable --now one-kvm
```

### 验证硬件编码器

```bash
v4l2-ctl -d /dev/video0 -D
# 输出应包含：Driver name: meson_hcodec
```

### 硬件支持

继承所有 B860 Armbian 硬件支持：
- Amlogic S905L3-B（四核 Cortex-A55，1.8 GHz）
- H.264 硬件编码器（V4L2 M2M，最高 1920x1088）
- 100 Mbps 有线网络、RTL8189FTV Wi-Fi
- 8 GB eMMC、1 GB RAM

### 文档

- [快速开始指南](QUICKSTART.md)
- [故障排查](BUILDING.md#故障排查)

### 支持

- **问题反馈**：[GitHub Issues](https://github.com/wuhao1477/b860av1-t-one-kvm-builder/issues)
- **上游 B860**：[B860 Armbian](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder)
- **上游 One-KVM**：[One-KVM](https://github.com/mofeng-git/One-KVM)

---

## English

### Quick Start (Recommended)

**Prerequisites**: Flash [B860 Armbian v1.3.0](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/releases/tag/v1.3.0) first

Run one-click installation script on B860 device:

```bash
# SSH to B860 (default password: password)
ssh root@<B860-IP>

# Download and run install script
curl -fsSL https://raw.githubusercontent.com/wuhao1477/b860av1-t-one-kvm-builder/main/install-one-kvm.sh | bash

# Or step by step
wget https://raw.githubusercontent.com/wuhao1477/b860av1-t-one-kvm-builder/main/install-one-kvm.sh
chmod +x install-one-kvm.sh
./install-one-kvm.sh
```

Access One-KVM at: `http://<B860-IP>:8080` (default: `admin` / `admin`)

### Manual Installation

```bash
# 1. Download One-KVM
wget https://github.com/mofeng-git/One-KVM/releases/download/v260802/one-kvm_0.2.6_armhf.deb

# 2. Install
apt-get update
apt-get install -y ./one-kvm_0.2.6_armhf.deb

# 3. Configure hardware encoder
mkdir -p /etc/one-kvm
cat > /etc/one-kvm/encoder.conf << 'CONF'
backend=v4l2m2m
device=/dev/video0
CONF

# 4. Start service
systemctl enable --now one-kvm
```

### Verify Hardware Encoder

```bash
v4l2-ctl -d /dev/video0 -D
# Output should contain: Driver name: meson_hcodec
```

### Hardware Support

Inherits all B860 Armbian hardware support:
- Amlogic S905L3-B (quad-core Cortex-A55, 1.8 GHz)
- H.264 hardware encoder (V4L2 M2M, up to 1920x1088)
- 100 Mbps Ethernet, RTL8189FTV Wi-Fi
- 8 GB eMMC, 1 GB RAM

### Documentation

- [Quickstart Guide](QUICKSTART.md)
- [Troubleshooting](BUILDING.md#troubleshooting)

### Support

- **Issues**: [GitHub Issues](https://github.com/wuhao1477/b860av1-t-one-kvm-builder/issues)
- **Upstream B860**: [B860 Armbian](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder)
- **Upstream One-KVM**: [One-KVM](https://github.com/mofeng-git/One-KVM)

---

## License

MIT License — see [LICENSE](LICENSE)

Incorporates:
- B860 Armbian (MIT)
- One-KVM (GPL-3.0)

See [THIRD_PARTY.md](THIRD_PARTY.md).

⚠️ **Disclaimer**: Custom firmware may void warranty. Use at your own risk.
