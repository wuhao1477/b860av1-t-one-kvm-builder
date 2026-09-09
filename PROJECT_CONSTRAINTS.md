# 项目约束

本文档记录 b860av1-t-one-kvm-builder 的硬性约束和设计决策。

## 硬性约束

### ✅ 必须产出 burn.img

- **约束**：本项目**只能**产出开箱即用的 `burn.img` 刷机包
- **禁止**：一键安装脚本（`install-one-kvm.sh`）
- **原因**：项目定位是"基于基础镜像二次构建的 burn.img 包的项目"

### ✅ 必须基于 B860 Armbian 开发者产物

- **依赖**：
  - `Armbian_*.img.gz` — raw 镜像（来自 B860 Armbian release）
  - `boot-components.json` — 启动组件元数据
  - `resolved-sources.json` — 冻结的上游输入
- **构建路径**：
  ```bash
  # 1. 下载开发者产物
  gh release download <tag> --repo wuhao1477/b860av1-t-armbian-burn-builder \
    --pattern "Armbian_*.img.gz" --pattern "boot-components.json"
  
  # 2. 设置 ONE_KVM_DEB 环境变量
  export ONE_KVM_DEB=/path/to/one-kvm.deb
  
  # 3. 运行 B860 构建脚本
  cd b860av1-t-armbian-burn-builder
  ./scripts/build-burn-payloads.sh ../Armbian_*.img.gz ./payloads
  ./scripts/build-vendor-boot-burn.sh ./payloads ./out
  
  # 输出：out/burn.img
  ```

## 当前状态

### v1.3.0 阶段

- ❌ B860 Armbian v1.3.0 **未提供**开发者产物
- ❌ 无法构建 burn.img（缺少源文件）
- ⏳ 等待 B860 Armbian v1.4.0+ 提供开发者产物

### v1.4.0+ 计划

- ✅ B860 Armbian 将在每个 release 发布开发者产物
- ✅ One-KVM Builder 可以基于这些产物构建完整 burn.img
- ✅ 用户下载即可刷写，无需事后安装

## 技术背景

### 为什么不能用一键安装脚本？

一键安装脚本（`install-one-kvm.sh`）是事后安装方案：
1. 先刷入基础 B860 Armbian
2. SSH 登录后运行脚本安装 One-KVM

这**不符合**项目定位"产出 burn.img 包"。

### 为什么 v1.3.0 无法构建？

B860 Armbian v1.3.0 只发布了最终的 `burn.img.xz`，没有发布构建所需的：
- raw 镜像（Armbian_*.img.gz）
- boot-components.json
- resolved-sources.json

没有这些文件，无法进行二次构建。

### 解决路径

1. **短期**：等待 B860 Armbian v1.4.0
   - 已修改 `.github/workflows/weekly-burn-build.yml` 发布开发者产物
   - 下次构建会自动包含这些文件

2. **长期**：完整的构建流程
   - B860 Armbian weekly-build 构建 raw 镜像
   - B860 Armbian weekly-burn-build 基于 raw 镜像构建 burn.img
   - 同时发布用户产物（burn.img）和开发者产物（raw + 元数据）
   - One-KVM Builder 基于开发者产物二次构建

## 项目范围

### ✅ 在范围内
- 基于 B860 Armbian 开发者产物构建 burn.img
- 注入 One-KVM 软件包
- 配置硬件编码器
- 生成开箱即用的刷机包

### ❌ 不在范围内
- 一键安装脚本
- 事后修改已刷入的系统
- 手动安装指南
- 非 burn.img 的分发方式

## 许可

MIT License

本项目基于：
- B860 Armbian (MIT)
- One-KVM (GPL-3.0)

详见 [THIRD_PARTY.md](THIRD_PARTY.md)。
