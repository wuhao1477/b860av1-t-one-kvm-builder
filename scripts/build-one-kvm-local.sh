#!/usr/bin/env bash
set -Eeuo pipefail

# 本地构建 B860 One-KVM：基于已发布的 B860 Armbian，在 rootfs 构建阶段注入 One-KVM
#
# 方案：
# 1. 克隆 B860 Armbian 仓库
# 2. 修改 apply-rootfs-defaults.sh 添加 One-KVM 注入
# 3. 下载已发布的 Armbian raw 镜像源码包
# 4. 运行 build-burn-payloads.sh + build-vendor-boot-burn.sh
# 5. 生成带 One-KVM 的 burn.img

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
WORK_DIR=${WORK_DIR:-$ROOT_DIR/work-local}
OUTPUT_DIR=${OUTPUT_DIR:-$ROOT_DIR/output}

B860_REPO=${B860_REPO:-https://github.com/wuhao1477/b860av1-t-armbian-burn-builder.git}
B860_TAG=${B860_TAG:-v1.3.0}
ONE_KVM_TAG=${ONE_KVM_TAG:-latest}

B860_CLONE="$WORK_DIR/b860-armbian"
ONE_KVM_DEB="$WORK_DIR/one-kvm.deb"

echo "==> B860 One-KVM 本地构建"
echo "    B860 Armbian: $B860_TAG"
echo "    One-KVM: $ONE_KVM_TAG"
echo ""

mkdir -p "$WORK_DIR" "$OUTPUT_DIR"

# 1. 克隆 B860 Armbian
if [[ ! -d "$B860_CLONE" ]]; then
  echo "==> 克隆 B860 Armbian 仓库"
  git clone --branch "$B860_TAG" --depth 1 "$B860_REPO" "$B860_CLONE"
else
  echo "==> B860 Armbian 仓库已存在，跳过克隆"
fi

cd "$B860_CLONE"

# 2. 下载 One-KVM
if [[ ! -f "$ONE_KVM_DEB" ]]; then
  echo "==> 下载 One-KVM"
  if [[ "$ONE_KVM_TAG" == "latest" ]]; then
    ONE_KVM_URL=$(curl -s https://api.github.com/repos/mofeng-git/One-KVM/releases/latest | \
      jq -r '.assets[] | select(.name | endswith("_armhf.deb")) | .browser_download_url')
  else
    ONE_KVM_URL=$(curl -s "https://api.github.com/repos/mofeng-git/One-KVM/releases/tags/${ONE_KVM_TAG}" | \
      jq -r '.assets[] | select(.name | endswith("_armhf.deb")) | .browser_download_url')
  fi

  echo "    URL: $ONE_KVM_URL"
  curl -L "$ONE_KVM_URL" -o "$ONE_KVM_DEB"

  dpkg-deb -I "$ONE_KVM_DEB" | grep -q "Architecture: armhf" || {
    echo "错误：不是 armhf 架构" >&2
    exit 1
  }
else
  echo "==> One-KVM 已下载，跳过"
fi

# 3. 修改 apply-rootfs-defaults.sh 添加 One-KVM 注入
echo "==> 修改 apply-rootfs-defaults.sh"
if ! grep -q "注入 One-KVM" scripts/apply-rootfs-defaults.sh; then
  cat >> scripts/apply-rootfs-defaults.sh << 'INJECT_CODE'

# ---- 8. 注入 One-KVM（本地构建）-----------------------------------------------
if [[ -n "${ONE_KVM_DEB:-}" && -f "$ONE_KVM_DEB" ]]; then
  say "检测到 ONE_KVM_DEB，开始注入 One-KVM"

  $sudo dpkg-deb -x "$ONE_KVM_DEB" "$root_mount/"

  if ! $sudo test -f "$root_mount/usr/bin/one-kvm"; then
    echo "One-KVM 二进制未找到" >&2
    exit 1
  fi

  if $sudo test -f "$root_mount/lib/systemd/system/one-kvm.service"; then
    $sudo mkdir -p "$root_mount/etc/systemd/system/multi-user.target.wants"
    $sudo ln -sf /lib/systemd/system/one-kvm.service \
      "$root_mount/etc/systemd/system/multi-user.target.wants/one-kvm.service"
    say "已启用 one-kvm.service"
  fi

  $sudo mkdir -p "$root_mount/etc/one-kvm"
  $sudo tee "$root_mount/etc/one-kvm/encoder.conf" >/dev/null <<'ENCODER_CONF'
backend=v4l2m2m
device=/dev/video0
ENCODER_CONF
  say "已配置 V4L2 硬件编码器"

  one_kvm_version=$(dpkg-deb -f "$ONE_KVM_DEB" Version 2>/dev/null || echo "unknown")
  $sudo tee "$root_mount/etc/b860-one-kvm-release" >/dev/null <<EOF
ONE_KVM_VERSION=$one_kvm_version
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BASE=B860 Armbian $B860_TAG
EOF

  say "已注入 One-KVM $one_kvm_version"
fi
INJECT_CODE
fi

# 4. 下载 B860 Armbian release 的源文件
echo "==> 下载 B860 Armbian $B860_TAG 源文件"
SOURCE_DIR="$WORK_DIR/source-assets"
mkdir -p "$SOURCE_DIR"

gh release download "$B860_TAG" \
  --repo wuhao1477/b860av1-t-armbian-burn-builder \
  --pattern "Armbian_*.img.gz" \
  --pattern "boot-components.json" \
  --dir "$SOURCE_DIR/" || {
  echo "错误：下载 B860 Armbian release 失败" >&2
  echo "请手动下载以下文件到 $SOURCE_DIR/:" >&2
  echo "  - Armbian_*.img.gz" >&2
  echo "  - boot-components.json" >&2
  exit 1
}

RAW_IMAGE=$(ls "$SOURCE_DIR"/Armbian_*.img.gz | head -1)
echo "    Raw image: $(basename "$RAW_IMAGE")"

# 5. 运行构建
echo "==> 构建 burn payloads（注入 One-KVM）"
export ONE_KVM_DEB
./scripts/setup-image-tools.sh
export PATH="$PWD/.tools/bin:$PATH"

PAYLOAD_DIR="$WORK_DIR/payloads"
./scripts/build-burn-payloads.sh "$RAW_IMAGE" "$PAYLOAD_DIR"

echo "==> 构建 burn image"
BURN_OUT="$WORK_DIR/burn-out"
./scripts/build-vendor-boot-burn.sh "$PAYLOAD_DIR" "$BURN_OUT"

# 6. 压缩并复制到输出目录
echo "==> 压缩输出"
ONE_KVM_VERSION=$(dpkg-deb -f "$ONE_KVM_DEB" Version 2>/dev/null || echo "unknown")
OUTPUT_NAME="B860-One-KVM-base-${B860_TAG}-onekvm-v${ONE_KVM_VERSION}.burn.img"

cp "$BURN_OUT/burn.img" "$OUTPUT_DIR/$OUTPUT_NAME"
xz -9 -T0 "$OUTPUT_DIR/$OUTPUT_NAME"

cd "$OUTPUT_DIR"
sha256sum "$(basename "$OUTPUT_NAME.xz")" > SHA256SUMS

echo ""
echo "==> 构建完成！"
echo "    输出: $OUTPUT_DIR/$(basename "$OUTPUT_NAME.xz")"
ls -lh "$OUTPUT_DIR/$(basename "$OUTPUT_NAME.xz")"
