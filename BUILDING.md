# 构建说明

## 方式一：本地构建（推荐）

在 Linux 环境下本地构建开箱即用的 B860 One-KVM 固件。

### 前置要求

- Linux 环境（Ubuntu 22.04+ 或 Debian 12+）
- 8 GB+ RAM
- 20 GB+ 可用磁盘空间
- 互联网连接

### 依赖安装

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
  git curl jq xz-utils nodejs npm \
  gcc-aarch64-linux-gnu \
  mtools dosfstools e2fsprogs kmod device-tree-compiler \
  python3 bc bison flex make

# 安装 GitHub CLI
# Ubuntu/Debian:
sudo apt-get install gh

# 或从官网下载: https://github.com/cli/cli#installation
```

### 构建步骤

```bash
# 1. 克隆仓库
git clone https://github.com/wuhao1477/b860av1-t-one-kvm-builder.git
cd b860av1-t-one-kvm-builder

# 2. 运行构建脚本
./scripts/build-one-kvm-local.sh

# 构建过程：
# - 克隆 B860 Armbian 仓库（v1.3.0）
# - 下载 One-KVM 最新 armhf deb
# - 修改 apply-rootfs-defaults.sh 注入 One-KVM
# - 下载 B860 Armbian release 源文件
# - 编译 meson_hcodec 模块
# - 构建 burn payloads（注入 One-KVM 到 rootfs）
# - 打包 burn 镜像
# - 压缩输出

# 3. 查看输出
ls -lh output/
# 输出文件：B860-One-KVM-base-v1.3.0-onekvm-v0.2.6.burn.img.xz
```

构建耗时：20-30 分钟（首次构建，取决于下载速度和 CPU）。

### 自定义构建

```bash
# 指定 One-KVM 版本
ONE_KVM_TAG=v0.2.6 ./scripts/build-one-kvm-local.sh

# 指定 B860 Armbian 版本
B860_TAG=v1.3.0 ./scripts/build-one-kvm-local.sh

# 指定工作目录和输出目录
WORK_DIR=/tmp/b860-build OUTPUT_DIR=$PWD/dist ./scripts/build-one-kvm-local.sh
```

## 方式二：手动安装（已有 B860 Armbian）

如果已刷入 B860 Armbian v1.3.0，可以手动安装 One-KVM：

```bash
# 1. SSH 登录 B860（默认密码：password）
ssh root@<B860-IP>

# 2. 下载 One-KVM
wget https://github.com/mofeng-git/One-KVM/releases/download/v260802/one-kvm_0.2.6_armhf.deb

# 3. 安装
apt-get update
apt-get install -y ./one-kvm_0.2.6_armhf.deb

# 4. 配置硬件编码器
mkdir -p /etc/one-kvm
cat > /etc/one-kvm/encoder.conf << 'CONF'
backend=v4l2m2m
device=/dev/video0
CONF

# 5. 启动服务
systemctl enable --now one-kvm

# 6. 访问
# http://<B860-IP>:8080
# 默认凭据：admin / admin
```

## 构建原理

### 架构

```
输入：B860 Armbian v1.3.0 release
  ↓
1. 克隆 B860 builder 仓库
  ↓
2. 修改 apply-rootfs-defaults.sh
   添加 One-KVM 注入逻辑（读取 ONE_KVM_DEB 环境变量）
  ↓
3. 下载源文件
   - Armbian_*.img.gz（raw 镜像）
   - boot-components.json（启动组件元数据）
  ↓
4. 运行构建流程
   - setup-image-tools.sh：编译 ampack/gxlimg
   - build-burn-payloads.sh：
     * 解压 raw 镜像
     * 提取 boot 分区（FAT16）和 rootfs（ext4）
     * 调用 apply-rootfs-defaults.sh（注入 One-KVM）
     * 生成 boot.PARTITION 和 data.PARTITION
   - build-vendor-boot-burn.sh：
     * 打包 Android boot 镜像
     * 组装 Amlogic burn 容器
     * 输出 burn.img
  ↓
5. 压缩输出
   xz -9 压缩 burn.img
  ↓
输出：B860-One-KVM-*.burn.img.xz（开箱即用）
```

### 关键修改

`apply-rootfs-defaults.sh` 新增第 8 节：

```bash
# ---- 8. 注入 One-KVM（本地构建）-----------------------------------------------
if [[ -n "${ONE_KVM_DEB:-}" && -f "$ONE_KVM_DEB" ]]; then
  # 1. 解压 deb 到 rootfs
  $sudo dpkg-deb -x "$ONE_KVM_DEB" "$root_mount/"
  
  # 2. 启用 systemd 服务
  $sudo ln -sf /lib/systemd/system/one-kvm.service \
    "$root_mount/etc/systemd/system/multi-user.target.wants/one-kvm.service"
  
  # 3. 配置硬件编码器
  cat > "$root_mount/etc/one-kvm/encoder.conf" <<< 'backend=v4l2m2m
device=/dev/video0'
  
  # 4. 写入版本信息
  echo "ONE_KVM_VERSION=$version" > "$root_mount/etc/b860-one-kvm-release"
fi
```

### 验证

构建完成后，验证镜像：

```bash
# 1. 检查压缩完整性
xz -t output/B860-One-KVM-*.burn.img.xz

# 2. 验证 SHA256
cd output && sha256sum -c SHA256SUMS

# 3. 查看文件信息
ls -lh B860-One-KVM-*.burn.img.xz
# 预期大小：~450-500 MB（压缩后）
```

## 故障排查

### 构建失败

**问题**：`gh: command not found`

**解决**：安装 GitHub CLI
```bash
sudo apt-get install gh
```

---

**问题**：`aarch64-linux-gnu-gcc: not found`

**解决**：安装交叉编译工具链
```bash
sudo apt-get install gcc-aarch64-linux-gnu
```

---

**问题**：下载 B860 Armbian release 失败

**解决**：手动下载到 `work-local/source-assets/`
```bash
mkdir -p work-local/source-assets
cd work-local/source-assets

# 从 B860 Armbian releases 下载：
# https://github.com/wuhao1477/b860av1-t-armbian-burn-builder/releases/tag/v1.3.0
# - Armbian_26.11.0_amlogic_b860av1-t_trixie_5.10.268_server_2026.08.31.img.gz
# - boot-components.json
```

### 运行时问题

**问题**：One-KVM 服务未启动

**解决**：
```bash
# SSH 登录 B860
systemctl status one-kvm
journalctl -u one-kvm -f

# 手动启动
systemctl start one-kvm
```

---

**问题**：硬件编码器不工作

**解决**：
```bash
# 检查 V4L2 设备
ls -l /dev/video*

# 检查内核模块
lsmod | grep meson_hcodec

# 手动加载
modprobe meson_hcodec

# 查看配置
cat /etc/one-kvm/encoder.conf
```

## 下一步

- 刷机指南：参见主 [README.md](README.md)
- B860 Armbian 文档：https://github.com/wuhao1477/b860av1-t-armbian-burn-builder
- One-KVM 文档：https://github.com/mofeng-git/One-KVM
