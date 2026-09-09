#!/usr/bin/env bash
set -Eeuo pipefail

# B860 One-KVM 一键安装脚本
# 在已刷入 B860 Armbian 的设备上运行

ONE_KVM_TAG=${ONE_KVM_TAG:-latest}

echo "==> B860 One-KVM 一键安装"
echo ""

# 检查是否是 B860 Armbian
if [[ ! -f /etc/armbian-release ]]; then
  echo "错误：未检测到 Armbian 系统" >&2
  exit 1
fi

if [[ ! -c /dev/video0 ]]; then
  echo "警告：未检测到 /dev/video0 硬件编码器"
  echo "      请确认已刷入 B860 Armbian v1.3.0+"
fi

# 获取 One-KVM 下载 URL
echo "==> 获取 One-KVM $ONE_KVM_TAG"
if [[ "$ONE_KVM_TAG" == "latest" ]]; then
  ONE_KVM_URL=$(curl -s https://api.github.com/repos/mofeng-git/One-KVM/releases/latest | \
    jq -r '.assets[] | select(.name | endswith("_armhf.deb")) | .browser_download_url')
  ONE_KVM_VERSION=$(curl -s https://api.github.com/repos/mofeng-git/One-KVM/releases/latest | jq -r '.tag_name')
else
  ONE_KVM_URL=$(curl -s "https://api.github.com/repos/mofeng-git/One-KVM/releases/tags/${ONE_KVM_TAG}" | \
    jq -r '.assets[] | select(.name | endswith("_armhf.deb")) | .browser_download_url')
  ONE_KVM_VERSION="$ONE_KVM_TAG"
fi

if [[ -z "$ONE_KVM_URL" ]]; then
  echo "错误：无法获取 One-KVM 下载链接" >&2
  exit 1
fi

echo "    版本: $ONE_KVM_VERSION"
echo "    URL: $ONE_KVM_URL"

# 下载
TMP_DEB=$(mktemp --suffix=.deb)
trap "rm -f $TMP_DEB" EXIT

echo "==> 下载 One-KVM"
curl -L "$ONE_KVM_URL" -o "$TMP_DEB"

# 验证
if ! dpkg-deb -I "$TMP_DEB" | grep -q "armhf"; then
  echo "错误：不是 armhf 架构" >&2
  exit 1
fi

# 安装
echo "==> 安装 One-KVM"
apt-get update
apt-get install -y "$TMP_DEB"

# 配置硬件编码器
echo "==> 配置硬件编码器"
mkdir -p /etc/one-kvm
cat > /etc/one-kvm/encoder.conf << 'EOF'
backend=v4l2m2m
device=/dev/video0
EOF

# 启动服务
echo "==> 启动 One-KVM 服务"
systemctl enable one-kvm
systemctl restart one-kvm

# 等待服务启动
sleep 3

# 检查状态
if systemctl is-active --quiet one-kvm; then
  echo ""
  echo "✅ One-KVM 安装成功！"
  echo ""
  echo "访问地址：http://$(hostname -I | awk '{print $1}'):8080"
  echo "默认凭据：admin / admin"
  echo ""
  echo "验证硬件编码器："
  echo "  v4l2-ctl -d /dev/video0 -D"
else
  echo ""
  echo "⚠️  One-KVM 服务未启动"
  echo "查看日志："
  echo "  journalctl -u one-kvm -f"
fi
