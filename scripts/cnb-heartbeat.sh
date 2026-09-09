#!/usr/bin/env bash
set -Eeuo pipefail

heartbeat=.github/schedule-heartbeat
now=$(date -u +%s)
last=$(awk -F= '$1 == "last_checked" {print $2}' "$heartbeat" 2>/dev/null || true)
[[ "$last" =~ ^[0-9]+$ ]] || last=0
(( now - last < 42 * 86400 )) && exit 0

printf '%s\n' '# Updated by the scheduled CNB workflow; intentionally excluded from the build fingerprint.' "last_checked=$now" > "$heartbeat"
git config user.name "${CNB_BUILD_USER:-cnb-scheduler}"
git config user.email "${CNB_BUILD_USER_EMAIL:-cnb-scheduler@noreply.cnb.cool}"
git add "$heartbeat"
git -c commit.gpgsign=false commit -m 'chore(ops): 更新 CNB 计划任务心跳'
git push origin HEAD:main
