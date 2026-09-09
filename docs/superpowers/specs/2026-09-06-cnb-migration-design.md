# CNB 全量迁移设计

## 目标

将 `wuhao1477/b860av1-t-armbian-burn-builder` 从 GitHub Actions/Release 运行模型迁移到 CNB，使 CNB 成为唯一活跃代码、构建和发布平台；GitHub 仅保留为可读取的历史镜像。

## 当前事实

- GitHub 仓库公开，默认分支为 `main`，当前有 5 条工作流。
- 工作流覆盖 push、pull request、每周定时、手动触发、设备证据验证和 Release 发布。
- GitHub 当前有 7 个 Release、47 个附件，总附件大小约 9.4 GB。
- GitHub 没有 Issue、PR、分支保护规则或仓库 secrets/variables 需要迁移。
- CNB 仓库已经创建并接收 `main` 和 7 个 Git 标签，但尚无 `.cnb.yml`、构建记录或 Release。
- 工作区已有 3 个未提交的 H.264 编码器修改，迁移工作不得覆盖或提交这些修改。

## 行为映射

### 代码与协作

- CNB `main` 保持 GitHub 当前 `main` 的提交和标签对象。
- `.cnb.yml` 成为 CNB 构建入口。
- `.cnb/web_trigger.yml` 提供原 `workflow_dispatch` 的 `force`、`release_tag`、`evidence_path`、`confirmation` 输入。
- CNB `pull_request` 事件替代 GitHub `pull_request`；无 GitHub PR 历史需要导入。
- CNB 未配置分支保护，保持 GitHub 当前“未保护”状态。

### CI

- `push` 和 `pull_request` 触发主 CI，包含 Node 22/pnpm 测试、shell 语法检查、source-only 检查、U-Boot/DTB 双编译一致性检查。
- evidence PR 检查使用 `ifModify` 只在 `evidence/**` 有变化时运行。
- 同一流水线内使用 CNB stage/job 工作区传递中间文件，不依赖 GitHub artifact。

### 每周 raw 镜像

- `main` 上每周一 `23 3 * * 1` 触发；web trigger 可强制执行。
- detect 阶段仍解析上游 GitHub 公共 Release，但项目自己的 Release 查询、下载和发布全部改为 CNB API。
- build/validate 阶段保持现有脚本、校验和产物文件集合。
- publish 阶段在 CNB 创建 prerelease，上传全部候选产物并逐项校验大小和 SHA-256。

### 每周 burn 镜像

- 保持同一 cron 和 `force` 手动输入。
- 固定输入从 CNB 的 `input-armbian-*` Release 下载。
- 保持现有 burn image、xz、合同 JSON、`SHA256SUMS` 和 Release notes 产物集合。
- 创建并验证 CNB prerelease 后再标记为非草稿。

### 设备证据

- PR 校验从 CNB Release 下载精确资产，继续调用现有 `validate-device-evidence.mjs`。
- 手动验证先校验 `confirmation=verify`，再发布唯一命名的三份设备证据资产；禁止修改原有报告、镜像、tag 或 Release 状态。

### 历史 Release

- 按原 tag、标题、说明、draft/prerelease/latest 状态创建 CNB Release。
- 从 GitHub 下载 47 个附件，上传到对应 CNB Release，逐个比较文件名、大小和 SHA-256。
- 历史迁移完成并验证后，GitHub Actions 工作流全部停用；GitHub 仓库不删除。

## 实现边界

- 上游第三方 GitHub 仓库、GitHub API 和 raw.githubusercontent.com 链接继续保留，它们不是本项目的托管对象。
- GitHub Actions 历史运行记录不能写入 CNB，因此只迁移可重复的触发、构建、发布行为。
- GitHub 仓库现有 `.github/workflows` 文件保留作为历史契约和迁移依据；GitHub 仓库停用 Actions 后不再执行。
- Release API 适配放在独立脚本中，统一处理列表、读取、下载、创建、上传、确认和完整性校验，避免在多个流水线中复制 curl 细节。

## 验收标准

1. CNB 配置和 web trigger 通过 CNB validator。
2. 本地测试、shell 语法检查和 source-only 检查通过。
3. CNB push/PR CI 至少有一次成功构建记录。
4. CNB 历史 Release 数量、tag、标题、状态、附件名称、大小和 SHA-256 与 GitHub 一致。
5. CNB 手动 raw/burn 构建入口可触发，产物能在 CNB Release 下载。
6. CNB 设备证据校验可读取 CNB Release 资产。
7. GitHub Actions 工作流状态为 disabled，GitHub 仓库未被删除。
8. 本地 3 个已有未提交 H.264 文件内容和状态保持不变。
