# CNB 无 Loop Burn 构建修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让 CNB SaaS 的普通 Linux Docker Runner 在没有 loop、FUSE 和特权设备的条件下完成 B860 burn 载荷构建。

**Architecture:** 保留现有 .cnb.yml、CNB Release 发布和 GitHub 工作流的业务流程，只替换 scripts/build-burn-payloads.sh 的设备依赖。脚本依据 raw 镜像 MBR 的 LBA 和扇区数，用 dd 抽取 FAT 与 ext4 分区；rootfs 通过 debugfs rdump 解包到普通目录，继续运行现有预置脚本，再用文件树差异同步回原 ext4 文件。最终仍使用现有 burn-image.mjs sparse 生成 data.PARTITION。

**Tech Stack:** Bash, Node.js 22 内置 fs/child_process, debugfs, e2fsck, mtools, dd, CNB SaaS Runner。

**Spec:** docs/burn-image.md；CNB 官方文档：从 GitHub Actions 迁移、构建环境、构建节点、流水线语法。

## Global Constraints

- CNB SaaS 构建运行在 Linux Docker 容器中；官方 services: docker 只提供 Docker-in-Docker，不作为宿主机特权或 loop 能力来源。
- 不修改 .cnb.yml 的 Runner 配置，不加入 --privileged、Docker-in-Docker 或 FUSE 依赖。
- 不重建整个 ext4；从原分区文件复制后，只同步新增、删除或修改的路径，未改变的路径保持原字节和 inode。
- 保留 root filesystem UUID、分区逻辑容量、boot FAT16 几何和现有 boot metadata 校验。
- 不触碰工作区已有的 scripts/hcodec-v4l2-qemu.sh、tests/hcodec-encoder.test.mjs、tools/hcodec-mod/meson_hcodec.c 未提交修改。
- 不新增 npm 依赖；Node 侧只使用内置模块，Linux 侧使用现有 e2fsprogs、mtools 和 coreutils。
- 不修改发布/迁移流程；修复范围限定为 burn payload 构建及其指纹、文档和测试。

### Task 1: 建立无 Loop 构建契约

Files:
- Modify: tests/burn-rootfs-contract.test.mjs
- Modify: tests/mainline-workflow-contract.test.mjs

Interfaces:
- Consumes: 当前 scripts/build-burn-payloads.sh、scripts/cnb-weekly-burn-build.sh 和 .github/workflows/weekly-burn-build.yml。
- Produces: 能在当前实现上失败、在目标实现上通过的静态契约测试。

- [ ] Step 1: 写失败测试

在 tests/burn-rootfs-contract.test.mjs 增加以下测试：

    test('burn payloads do not require loop devices or filesystem mounts', () => {
      const packager = read('scripts/build-burn-payloads.sh');

      assert.doesNotMatch(packager, /\b(losetup|lsblk|udevadm|mountpoint)\b/);
      assert.doesNotMatch(packager, /\bsudo\s+(mount|umount)\b/);
      assert.match(packager, /readUInt32LE/);
      assert.match(packager, /dd if="\$tmp\/raw\.img"/);
      assert.match(packager, /debugfs -R "rdump \/ /);
      assert.match(packager, /sync-rootfs-tree\.mjs/);
      assert.match(packager, /e2fsck -pf "\$tmp\/rootfs\.ext4"/);
    });

将现有断言从“挂载 $root_part 后调用预置脚本、再 dd”改成以下顺序：raw MBR 解析 -> dd 得到 rootfs.ext4 -> rdump -> apply-rootfs-defaults.sh -> sync-rootfs-tree.mjs -> e2fsck/debugfs 校验 -> sparse。保留现有 UUID、FAT、模块依赖和预置内容断言。

- [ ] Step 2: 运行测试确认是正确的 RED

运行：

    node --test tests/burn-rootfs-contract.test.mjs tests/mainline-workflow-contract.test.mjs

预期：失败原因为当前脚本仍包含 losetup/挂载逻辑和旧调用顺序，而不是测试语法错误。

- [ ] Step 3: 提交测试契约

    git add tests/burn-rootfs-contract.test.mjs tests/mainline-workflow-contract.test.mjs
    git commit -S -m "test(cnb): 约束 burn 构建不依赖 loop"

### Task 2: 实现 ext4 文件树差异同步器

Files:
- Create: scripts/sync-rootfs-tree.mjs
- Create: tests/sync-rootfs-tree.test.mjs

Interfaces:
- Consumes: image.ext4、原始解包目录和修改后的目录。
- Produces: node scripts/sync-rootfs-tree.mjs image.ext4 before after；导出的 diffRootfsTrees(beforeDir, afterDir) 返回带 kind、path 和元数据的有序操作。

- [ ] Step 1: 写失败单元测试

测试树必须覆盖：保持不变的文件、删除的文件、内容变化的普通文件、新目录、新文件、变化的符号链接，以及文件类型变化。断言差异结果包含：

    [
      { kind: 'remove', path: '/etc/remove' },
      { kind: 'replace', path: '/etc/change', type: 'file' },
      { kind: 'mkdir', path: '/usr/local/sbin' },
      { kind: 'write', path: '/usr/local/sbin/new-helper', mode: 0o755 },
      { kind: 'symlink', path: '/etc/new-link', target: '/etc/keep' }
    ]

比较必须使用 lstat、普通文件字节、符号链接目标、权限、UID 和 GID；忽略时间戳；不把未变化路径加入操作列表。

- [ ] Step 2: 运行测试确认缺少实现

运行：

    node --test tests/sync-rootfs-tree.test.mjs

预期：因 scripts/sync-rootfs-tree.mjs 尚不存在而失败。

- [ ] Step 3: 编写最小同步实现

按以下顺序生成 debugfs 命令：

    删除路径：最深路径优先
    替换类型或内容变化：unlink 后 write 或 symlink
    创建目录：最浅路径优先
    写入普通文件
    对新增或变化路径设置 mode、uid、gid

使用 Node 内置模块创建临时命令文件，再执行：

    rm "/path/in/ext4"
    rmdir "/path/in/ext4"
    mkdir "/path/in/ext4"
    write "/host/tree/file" "/path/in/ext4"
    symlink "/path/in/ext4" "/target"
    set_inode_field "/path/in/ext4" mode 0755
    set_inode_field "/path/in/ext4" uid 0
    set_inode_field "/path/in/ext4" gid 0

实现要求：
- 拒绝设备文件、FIFO、socket 和无法安全表达的硬链接拓扑变化。
- 所有 ext4 内部路径必须是绝对路径，拒绝 ..、空路径和未转义的引号。
- 不触碰未变化路径，不调用 mke2fs，不重新生成整个 filesystem。
- debugfs 命令失败时退出非零，并把目标 ext4 路径写入错误信息。

- [ ] Step 4: 运行同步器测试

运行：

    node --test tests/sync-rootfs-tree.test.mjs
    node --check scripts/sync-rootfs-tree.mjs

预期：差异排序、类型识别和命令生成测试通过。

- [ ] Step 5: 提交同步器

    git add scripts/sync-rootfs-tree.mjs tests/sync-rootfs-tree.test.mjs
    git commit -S -m "feat(cnb): 增加 ext4 文件树同步器"

### Task 3: 将 burn payload builder 改为普通文件处理

Files:
- Modify: scripts/build-burn-payloads.sh
- Modify: scripts/cnb-weekly-burn-build.sh
- Modify: .github/workflows/weekly-burn-build.yml

Interfaces:
- Consumes: raw .img.gz、boot-components.json、现有 rootfs 预置脚本和 Task 2 的同步器。
- Produces: 与当前相同的 boot.PARTITION、data.PARTITION 和 JSON stdout，不需要 loop、挂载或特权设备。

- [ ] Step 1: 写调用顺序失败断言

在 tests/burn-rootfs-contract.test.mjs 增加：

    const packager = read('scripts/build-burn-payloads.sh');
    const extract = packager.indexOf('debugfs -R "rdump /');
    const defaults = packager.indexOf('apply-rootfs-defaults.sh');
    const sync = packager.indexOf('sync-rootfs-tree.mjs');
    const sparse = packager.indexOf('burn-image.mjs" sparse');

    assert.ok(extract >= 0 && extract < defaults);
    assert.ok(defaults < sync && sync < sparse);

运行 focused test，确认当前挂载版本在顺序断言处失败。

- [ ] Step 2: 解析并校验 raw 镜像 MBR

解压完成后，以现有 scripts/build-ophub-bl33-burn.sh 的 inline Node MBR 解析模式为基础读取 sector 0：
- 校验 0xaa55 签名。
- 拒绝不完整、越过 raw 文件末尾或数量不等于 2 的分区项。
- 要求第一个分区为 type 0x0e，第二个分区为 type 0x83。
- 输出两组 start LBA 和 sector count，全部计算使用 512 字节扇区。

- [ ] Step 3: 用 dd 抽取两个独立分区文件

删除 losetup、udevadm、lsblk、mount、umount、设备上的 blkid 和 blockdev，改为：

    dd if="$tmp/raw.img" of="$tmp/source-boot.PARTITION" \
      bs=512 skip="$boot_start" count="$boot_sectors" status=none
    dd if="$tmp/raw.img" of="$tmp/rootfs.ext4" \
      bs=512 skip="$root_start" count="$root_sectors" status=none
    root_size=$((root_sectors * 512))
    root_uuid=$(blkid --match-tag UUID --output value "$tmp/rootfs.ext4" | tr '[:upper:]' '[:lower:]')

把所有 boot 文件的 mcopy 输入改为 $tmp/source-boot.PARTITION。保留现有 root UUID 格式检查和 boot component digest 检查。

- [ ] Step 4: 在解包目录执行预置并同步差异

使用：

    mkdir -p "$tmp/root-before" "$tmp/root-tree"
    debugfs -R "rdump / $tmp/root-before" "$tmp/rootfs.ext4" >/dev/null
    cp -a "$tmp/root-before/." "$tmp/root-tree/"
    SUDO= "$root/scripts/apply-rootfs-defaults.sh" "$tmp/root-tree"
    node "$root/scripts/sync-rootfs-tree.mjs" \
      "$tmp/rootfs.ext4" "$tmp/root-before" "$tmp/root-tree"

在 $tmp/root-tree 上继续执行现有内核 release、firmware、module 和 board.json 检查；在 $tmp/rootfs.ext4 上执行 e2fsck -pf 后，再执行现有 debugfs stat、debugfs cat 和 wants 目录检查。sparse 的输入必须是同一个 $tmp/rootfs.ext4。

- [ ] Step 5: 清理旧设备变量并保留输出契约

cleanup() 只删除 $tmp；删除 loop、root_mount、boot_mount 以及对应 teardown。保留 FAT 创建、burn-image.mjs sparse、UUID 校验和 JSON stdout，不改变下游脚本接口。

- [ ] Step 6: 让同步器参与构建指纹

把 scripts/sync-rootfs-tree.mjs 加入以下两处的 sha256sum 输入列表：
- scripts/cnb-weekly-burn-build.sh
- .github/workflows/weekly-burn-build.yml

这样同步器变化会触发 CNB 和 GitHub burn fingerprint 变化，不会被 unchanged fingerprint 跳过。

- [ ] Step 7: 运行 focused 验证

运行：

    node --test tests/burn-rootfs-contract.test.mjs tests/mainline-workflow-contract.test.mjs tests/sync-rootfs-tree.test.mjs
    bash -n scripts/build-burn-payloads.sh scripts/cnb-weekly-burn-build.sh
    node --check scripts/sync-rootfs-tree.mjs

预期：测试通过，两个 burn shell 脚本语法通过，Node 脚本语法通过，payload builder 不再包含 loop 或挂载操作。

- [ ] Step 8: 提交 builder 改动

    git add scripts/build-burn-payloads.sh scripts/cnb-weekly-burn-build.sh \
      .github/workflows/weekly-burn-build.yml \
      tests/burn-rootfs-contract.test.mjs tests/mainline-workflow-contract.test.mjs
    git commit -S -m "fix(cnb): 让 burn 构建脱离 loop 设备"

### Task 4: 更新文档和静态测试

Files:
- Modify: docs/burn-image.md
- Modify: tests/rootfs-defaults.test.mjs

Interfaces:
- Consumes: Task 3 的普通文件处理流程。
- Produces: 与 CNB 官方构建环境说明一致的操作文档和回归断言。

- [ ] Step 1: 更新构建前提

把“需要 Linux + loop 分区支持”改成“需要 Linux 用户态工具（e2fsprogs、mtools、dosfstools、gzip、dd 和 Node.js），不需要 loop、FUSE 挂载或挂载权限”。说明分区来自 raw MBR，rootfs 预置先在 debugfs rdump 目录执行，再按文件树差异同步回 ext4。

- [ ] Step 2: 更新 rootfs 预置测试

保留现有预置行为测试；把“dd 后检查挂载分区”的静态断言改为检查 rootfs.ext4、rdump、SUDO=、sync-rootfs-tree.mjs、post-sync e2fsck 和 debugfs 校验。不要删除 module modules.dep、vdec firmware、UUID 和 sparse 输出断言。

- [ ] Step 3: 运行完整本地检查

运行：

    pnpm test
    pnpm check
    git diff --check
    git status --short

预期：测试和 shell 检查通过；状态中只有计划内 CNB 文件以及三个预先存在的 hcodec 文件。

- [ ] Step 4: 提交文档和测试

    git add docs/burn-image.md tests/rootfs-defaults.test.mjs
    git commit -S -m "docs(cnb): 更新无 loop burn 构建说明"

### Task 5: 在 CNB Runner 上做不发布 Release 的端到端验证

Files:
- No repository files during this task; use a one-off CNB API trigger after the implementation branch is pushed.

Interfaces:
- Consumes: 已推送的修复分支、现有 scripts/cnb-weekly-burn-build.sh 的 setup、detect、build。
- Produces: CNB Runner 上的 build success、产物校验和无设备依赖日志证据，不执行 publish。

- [ ] Step 1: 推送实现分支

将带签名的实现提交推送到 auto/fix-cnb-burn-loopless，保留三个已有 hcodec 工作区修改不暂存、不提交。不合入 main。

- [ ] Step 2: 用临时 API 配置运行 setup/detect/build

通过 cnb build start-build 指定修复分支、api_trigger 和临时配置，只包含以下三个顺序阶段：

    "$":
      api_trigger:
        - name: verify loopless burn build
          docker:
            image: node:22-bookworm
          runner:
            cpus: 8
          stages:
            - name: setup
              timeout: 15m
              script: bash scripts/cnb-weekly-burn-build.sh setup
            - name: detect
              timeout: 15m
              script: bash scripts/cnb-weekly-burn-build.sh detect
              exports:
                changed: CNB_BURN_CHANGED
                fingerprint: CNB_BURN_FINGERPRINT
            - name: build
              if: '[ "$CNB_BURN_CHANGED" = "true" ]'
              timeout: 2h
              script: bash scripts/cnb-weekly-burn-build.sh build

不得把 publish 阶段放入临时配置。

- [ ] Step 3: 查询状态和 Runner 日志

使用返回的 SN 和 Pipeline ID 执行：

    cnb build get-build-status --repo wuhao1477/b860av1-t-armbian-burn-builder --sn "$SN"
    cnb build build-runner-download-log --repo wuhao1477/b860av1-t-armbian-burn-builder --pipelineId "$PIPELINE_ID"

验收条件：
- burn build stage 成功。
- 日志没有 losetup、mount、umount、lsblk、udevadm 调用。
- rootfs UUID 校验成功。
- debugfs 预置校验成功。
- ampack verify 成功。
- burn.img 和 burn.img.xz 存在且摘要一致。

- [ ] Step 4: 运行一次普通 push CI

确认现有 ci-test 和 ci-source-built-uboot 通过后，再考虑触发正式 api_trigger_weekly_burn。正式发布前不改变 Release 迁移配置。

- [ ] Step 5: 记录 CNB 验证结果

记录 CNB build SN、成功的 stage 名称和最终 git diff --stat。三个已有 hcodec 文件不进入本次 CNB 修复提交。

## Self-Review

- 官方迁移指南只指导 GitHub Actions 工作流如何映射到 CNB 的分支、事件、Pipeline、Stage、Docker 环境和制品，不承诺保留 GitHub Runner 的宿主机设备能力；因此修复落在构建脚本而不是凭空增加 Runner 特权配置。
- 官方语法把 services: docker 定义为 Docker-in-Docker；本仓库真实探测中，rootless Docker 的 --privileged 容器在 sysfs 挂载阶段失败，所以没有将该路径写入方案。
- FUSE 探测只证明 fuse2fs 包可安装并能启动库，不证明 CNB 容器有可用的 /dev/fuse 挂载路径，因此目标方案只依赖 debugfs 和普通文件。
- 方案不重建 ext4，不改发布接口，不改 .cnb.yml，并且把同步器纳入两个 burn fingerprint，覆盖了 CNB 与 GitHub 工作流的实际执行路径。
