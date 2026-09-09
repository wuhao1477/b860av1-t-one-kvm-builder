# CNB 全量迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本项目的 GitHub Actions、Release、附件产物和手动/定时触发行为迁移到 CNB，并完成真实构建验证。

**Architecture:** 用一个无依赖的 CNB Release API 适配脚本统一处理 CNB Release 元数据和附件；`.cnb.yml` 按 CI、raw、burn、evidence 四类流水线映射现有 GitHub 行为，使用 stage 工作区传递中间产物；`.cnb/web_trigger.yml` 映射原 workflow dispatch 输入。

**Tech Stack:** Node.js 22、pnpm、Bash、CNB YAML、CNB CLI/OpenAPI、GitHub CLI（仅用于上游下载和一次性历史 Release 读取）。

**Spec:** `docs/superpowers/specs/2026-09-06-cnb-migration-design.md`

## Global Constraints

- 保留当前 3 个未提交 H.264 文件，不把它们加入迁移提交。
- 项目自有 Release API、Release 下载和发布必须使用 CNB；上游第三方 GitHub 地址保持不变。
- 每个新增生产函数先写失败测试，再写最小实现；配置文件用 validator 校验。
- 不删除 GitHub 仓库；确认 CNB 构建和历史附件可用后，仅停用 GitHub Actions。
- 不把 token、密码或 presigned URL 写入 Git、日志或测试 fixture。

---

### Task 1: Release API adapter contract

**Files:**
- Create: `src/cnb-release.mjs`
- Create: `tests/cnb-release.test.mjs`
- Create: `scripts/cnb-release.mjs`
- Modify: `package.json`

**Interfaces:**
- `src/cnb-release.mjs` exports pure functions `normalizeCnbRelease(value)`, `releaseAssetMap(value)`, `releaseTagList(value)`, and `releaseAssetDigest(asset)`.
- `scripts/cnb-release.mjs` exposes CLI commands `get`, `list`, `download`, `create`, `upload`, and `verify`; all network calls use `CNB_API_ENDPOINT`, `CNB_TOKEN`, and `CNB_REPO_SLUG`.
- `scripts/cnb-release.mjs` emits GitHub-compatible local `release.json` fields (`tagName`, `isDraft`, `isPrerelease`, `assets`) so existing validators remain pure.

- [ ] Write tests for CNB response normalization, digest normalization, duplicate asset rejection, and token-free error messages.
- [ ] Run `pnpm exec node --test tests/cnb-release.test.mjs` and confirm failure because the module is absent.
- [ ] Implement pure normalization and validation functions.
- [ ] Implement CLI HTTP operations with streaming downloads/uploads and presigned URL confirmation.
- [ ] Run the focused test and the existing release-policy tests.

### Task 2: CNB pipeline configuration

**Files:**
- Create: `.cnb.yml`
- Create: `.cnb/web_trigger.yml`
- Create: `.ci/cnb-node.yml`
- Create: `.ci/cnb-release.yml`
- Create: `tests/cnb-pipeline.test.mjs`

**Interfaces:**
- `.cnb.yml` declares `main.push`, `**.pull_request`, main cron events, `$` web trigger events, and the `ci`, `weekly-raw`, `weekly-burn`, `device-evidence-pr`, and `verify-device` pipelines.
- `.cnb/web_trigger.yml` declares `weekly-raw`, `weekly-burn`, and `verify-device` buttons with the exact inputs from GitHub workflows.
- Shared shell setup exports Node 22/pnpm and uses an Ubuntu/Debian image with the native build packages required by the existing scripts.

- [ ] Write configuration contract tests for all triggers, input names, artifact/release stages, and the absence of GitHub-only execution variables.
- [ ] Run the focused test and CNB validator; confirm failure before files exist.
- [ ] Implement the smallest valid CNB configuration with stages corresponding to the five GitHub workflows.
- [ ] Add CNB Release upload/download stages using `scripts/cnb-release.mjs`.
- [ ] Run validator and configuration tests until green.

### Task 3: Port project-owned release consumers

**Files:**
- Modify: `scripts/audit-public-releases.sh`
- Modify: `scripts/resolve-sources.mjs`
- Modify: `.github/workflows/device-evidence-pr.yml`
- Modify: `.github/workflows/verify-device.yml`
- Modify: `tests/public-release-audit-script.test.mjs`
- Modify: `tests/upstream.test.mjs`
- Modify: `tests/workflow-contract.test.mjs`

**Interfaces:**
- `scripts/audit-public-releases.sh` accepts `CNB_REPO_SLUG` and invokes the CNB adapter for project releases while retaining GitHub access for upstream sources.
- Evidence workflows read `release.json` and assets from CNB paths without changing the evidence validator contract.

- [ ] Add failing tests proving project release queries use CNB variables and upstream queries still use GitHub URLs.
- [ ] Run focused tests and confirm failure.
- [ ] Replace project-owned `gh release` calls with the adapter; retain `gh` only for third-party sources where required.
- [ ] Run all affected tests and shell syntax checks.

### Task 4: Local and remote pipeline validation

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/device-validation.md`
- Modify: `docs/frozen-inputs.md`
- Modify: `docs/burn-image.md`
- Modify: `docs/known-issues.md`

- [ ] Add CNB URLs, trigger commands, Release download URLs, and the explicit GitHub archive boundary to user-facing docs.
- [ ] Run `pnpm test`, `bash -n scripts/*.sh tools/hcenc/*.sh`, repository-policy validation, and CNB validators.
- [ ] Commit only migration files with a signed `feat(cnb): 迁移构建发布流程到 CNB` commit; leave the 3 existing H.264 files unstaged.
- [ ] Push the migration commit to CNB `main` and record its SHA.
- [ ] Start a CNB push/CI build and inspect every stage log and final status.

### Task 5: Historical Release and artifact migration

**Files:**
- No repository source changes; use `scripts/cnb-release.mjs` and temporary download directories.

- [ ] Enumerate all GitHub releases and 47 assets into a manifest containing tag, state, name, size, and SHA-256.
- [ ] Download each asset into an explicit temporary directory and verify the GitHub digest before upload.
- [ ] Create CNB releases with matching tag, title, body, draft, prerelease, and latest state.
- [ ] Upload each asset through CNB presigned URL + confirmation API with permanent retention.
- [ ] Re-read CNB release metadata and compare every manifest row.
- [ ] Run `cnb-release.mjs verify` for all tags and retain the manifest outside Git only.

### Task 6: Disable the GitHub execution plane

**Files:**
- No repository source changes after Task 4.

- [ ] Confirm CNB CI success, CNB Release parity, and CNB web triggers.
- [ ] Disable all five GitHub Actions workflows using GitHub API.
- [ ] Verify every workflow is disabled and the GitHub repository remains readable.
- [ ] Verify CNB `main` is the only local push remote and GitHub remains fetch-only.

### Task 7: Final migration audit

- [ ] Compare Git refs, release manifest, pipeline configuration, triggers, and GitHub workflow states against the spec one by one.
- [ ] Re-run the full test and configuration validation commands.
- [ ] Verify the 3 pre-existing H.264 modifications are unchanged and uncommitted.
- [ ] Report any behavior that cannot be represented by CNB, specifically historical Actions run records.
