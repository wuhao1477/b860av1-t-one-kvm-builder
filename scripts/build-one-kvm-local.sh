#!/bin/bash
set -Eeuo pipefail

# B860 One-KVM 构建脚本
# 基于最新的 burn.img 集成 One-KVM

: "${B860_TAG:?B860_TAG is required}"
: "${ONE_KVM_TAG:?ONE_KVM_TAG is required}"
: "${WORK_DIR:=$PWD/work-local}"
: "${OUTPUT_DIR:=$PWD/output}"
: "${GH_TOKEN:?GH_TOKEN is required for gh CLI}"

export GH_TOKEN

echo "==> 构建参数"
echo "B860 Tag: $B860_TAG"
echo "One-KVM Tag: $ONE_KVM_TAG"
echo "Work Dir: $WORK_DIR"
echo "Output Dir: $OUTPUT_DIR"

mkdir -p "$WORK_DIR" "$OUTPUT_DIR"

# 1. 下载最新 burn.img
echo "==> 下载 B860 burn.img"
BURN_RELEASE=$(gh api repos/wuhao1477/b860av1-t-armbian-burn-builder/releases \
  --jq '[.[] | select(.prerelease and (.tag_name | startswith("b860-burn-")))] | first | .tag_name')

echo "使用 burn release: $BURN_RELEASE"

gh release download "$BURN_RELEASE" \
  --repo wuhao1477/b860av1-t-armbian-burn-builder \
  --pattern 'burn.img.xz' \
  --dir "$WORK_DIR"

echo "==> 解压 burn.img"
xz -d "$WORK_DIR/burn.img.xz"

# 2. 下载 One-KVM deb
echo "==> 下载 One-KVM $ONE_KVM_TAG"
gh release download "$ONE_KVM_TAG" \
  --repo mofeng-git/One-KVM \
  --pattern '*_arm64.deb' \
  --dir "$WORK_DIR"

# 3. 安装 ampack
if ! command -v ampack &>/dev/null; then
  echo "==> 构建 ampack"
  mkdir -p "$WORK_DIR/tools"
  git clone --depth 1 https://github.com/7Ji/ampack.git "$WORK_DIR/tools/ampack"
  cd "$WORK_DIR/tools/ampack"
  git checkout 46066067b2b06c387df14243e301742644aa77a1
  cargo build --release
  export PATH="$WORK_DIR/tools/ampack/target/release:$PATH"
  cd -
fi

# 4. 解包 burn.img
echo "==> 解包 burn.img"
mkdir -p "$WORK_DIR/unpack"
ampack unpack "$WORK_DIR/burn.img" "$WORK_DIR/unpack/"

# 5. 挂载 rootfs (data.PARTITION)
echo "==> 挂载 rootfs"
if ! command -v simg2img &>/dev/null; then
  echo "错误: 需要 android-sdk-libsparse-utils" >&2
  exit 1
fi

simg2img "$WORK_DIR/unpack/data.PARTITION" "$WORK_DIR/data.img"

LOOP=$(sudo losetup -f --show "$WORK_DIR/data.img")
echo "Loop device: $LOOP"

mkdir -p "$WORK_DIR/mnt"
sudo mount "$LOOP" "$WORK_DIR/mnt"

# 6. 安装 One-KVM
echo "==> 安装 One-KVM"
sudo cp /usr/bin/qemu-aarch64-static "$WORK_DIR/mnt/usr/bin/"
sudo cp "$WORK_DIR"/*.deb "$WORK_DIR/mnt/tmp/"

sudo chroot "$WORK_DIR/mnt" bash -c 'dpkg -i /tmp/*.deb && systemctl enable one-kvm'
sudo chroot "$WORK_DIR/mnt" bash -c 'usermod -aG video root'

# 7. 配置 V4L2 M2M
echo "==> 配置 V4L2 M2M 环境变量"
sudo mkdir -p "$WORK_DIR/mnt/etc/systemd/system/one-kvm.service.d"
cat <<'EOF' | sudo tee "$WORK_DIR/mnt/etc/systemd/system/one-kvm.service.d/10-amlogic-encoder.conf"
[Service]
Environment="ONE_KVM_V4L2M2M_ALLOW=1"
EOF

# 8. 配置 hidraw 权限
echo "==> 配置 hidraw 权限"
echo 'KERNEL=="hidraw*", GROUP="input", MODE="0660"' | sudo tee "$WORK_DIR/mnt/etc/udev/rules.d/99-hidraw.rules"

# 9. 配置 USB OTG device mode
echo "==> 配置 USB OTG device mode"
cat <<'EOF' | sudo tee "$WORK_DIR/mnt/etc/systemd/system/usb-otg-device-mode.service"
[Unit]
Description=Switch USB to Device Mode for OTG
Before=one-kvm.service
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "echo device > /sys/devices/platform/soc/d0078080.usb/usb_role/d0078080.usb-role-switch/role"
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo chroot "$WORK_DIR/mnt" bash -c 'systemctl enable usb-otg-device-mode.service'

# 10. 清理并卸载
echo "==> 清理"
sudo rm "$WORK_DIR/mnt/usr/bin/qemu-aarch64-static"
sudo rm "$WORK_DIR/mnt/tmp"/*.deb

sudo umount "$WORK_DIR/mnt"
sudo losetup -d "$LOOP"

# 11. 重新打包
echo "==> 重新打包 rootfs"
img2simg "$WORK_DIR/data.img" "$WORK_DIR/unpack/data.PARTITION"
rm "$WORK_DIR/data.img"

echo "==> 打包 burn.img"
OUTPUT_NAME="B860-One-KVM-base-${BURN_RELEASE}-onekvm-${ONE_KVM_TAG}.burn.img"
ampack pack --verify "$WORK_DIR/unpack/" "$OUTPUT_DIR/$OUTPUT_NAME"

# 12. 压缩
echo "==> 压缩"
xz -9 -T0 "$OUTPUT_DIR/$OUTPUT_NAME"

# 13. 校验和
echo "==> 生成校验和"
cd "$OUTPUT_DIR"
sha256sum "$OUTPUT_NAME.xz" > SHA256SUMS
cat SHA256SUMS

echo "==> 构建完成"
ls -lh "$OUTPUT_DIR"
