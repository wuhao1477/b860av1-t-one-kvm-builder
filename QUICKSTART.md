# 快速开始

## 获取开箱即用的 B860 One-KVM 固件

### 方式一：本地构建（20-30 分钟）

需要 Linux 环境（Ubuntu 22.04+ 或 Debian 12+）：

```bash
# 1. 安装依赖
sudo apt-get update && sudo apt-get install -y \
  git curl jq xz-utils nodejs gcc-aarch64-linux-gnu \
  mtools dosfstools e2fsprogs kmod device-tree-compiler gh

# 2. 克隆并构建
git clone https://github.com/wuhao1477/b860av1-t-one-kvm-builder.git
cd b860av1-t-one-kvm-builder
./scripts/build-one-kvm-local.sh

# 3. 输出在 output/ 目录
ls -lh output/B860-One-KVM-*.burn.img.xz
```

### 方式二：等待 Release（推荐新手）

预构建的固件将发布到 [GitHub Releases](https://github.com/wuhao1477/b860av1-t-one-kvm-builder/releases)。

**当前状态**：本地构建脚本已就绪，首个 release 构建中。

## 刷机步骤

1. **下载固件**
   - 本地构建：`output/B860-One-KVM-*.burn.img.xz`
   - 或从 Releases 下载

2. **解压**
   ```bash
   xz -d B860-One-KVM-*.burn.img.xz
   ```

3. **刷写**
   - 打开 **晶晨 USB 烧录工具**（Amlogic USB Burning Tool）
   - 加载 `*.burn.img`
   - 勾选 **"擦除 flash"** + **"擦除 bootloader"**
   - B860 进入 USB 烧录模式
   - 点击开始

4. **首次启动**
   - 等待 24 秒启动完成
   - 连接有线网络（DHCP 自动获取 IP）
   - 查看路由器获取设备 IP

5. **访问 One-KVM**
   ```
   http://<B860-IP>:8080
   ```
   - 默认用户名：`admin`
   - 默认密码：`admin`

## 验证硬件编码器

SSH 登录 B860（默认密码：`password`）：

```bash
ssh root@<B860-IP>

# 检查 V4L2 设备
v4l2-ctl -d /dev/video0 -D

# 输出应包含：
# Driver name      : meson_hcodec
# Card type        : Amlogic Video Hardware Encoder
```

## 下一步

- 详细构建指南：[BUILDING.md](BUILDING.md)
- B860 Armbian 文档：https://github.com/wuhao1477/b860av1-t-armbian-burn-builder
- One-KVM 使用文档：https://github.com/mofeng-git/One-KVM

## 故障排查

### 刷机失败

1. 确认勾选了 **"擦除 flash"** + **"擦除 bootloader"**
2. 尝试更换 USB 线缆
3. 参考 [B860 刷机指南](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/blob/main/docs/burn-image.md)

### One-KVM 无法访问

```bash
# SSH 登录检查服务状态
systemctl status one-kvm

# 查看日志
journalctl -u one-kvm -f

# 手动启动
systemctl restart one-kvm
```

### 硬件编码器不工作

```bash
# 检查内核模块
lsmod | grep meson_hcodec

# 手动加载（通常开机自动加载）
modprobe meson_hcodec

# 检查配置
cat /etc/one-kvm/encoder.conf
# 应显示：
# backend=v4l2m2m
# device=/dev/video0
```

---

**需要帮助？**
- [GitHub Issues](https://github.com/wuhao1477/b860av1-t-one-kvm-builder/issues)
- [B860 Armbian Issues](https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/issues)
