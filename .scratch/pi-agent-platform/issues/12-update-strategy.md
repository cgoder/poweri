# 12 — 更新策略（不可变 + 锁版本 + 滚动）

**What to build:** 以不可变 + 锁版本镜像升级 pi，滚动替换并验证会话兼容、可回滚；容器内默认关闭 pi 自更新（PI_OFFLINE），版本完全由镜像 tag 控制。

**Blocked by:** 01 — pi 沙箱容器镜像

**Status:** done（commit 见下）

**Done:** scripts/build-image.mjs（tag + 锁 PI_VERSION + BUILD_MARKER）；Dockerfile 加 /etc/poweri-version 标记；verify-12 全链路过（跨版本续接 + 回滚）。

- [x] 升级 = 更换镜像 tag 滚动替换，旧版本可回滚（scripts/build-image.mjs 锁 PI_VERSION + BUILD_MARKER 标记；verify-12：v2 构建/切 tag/回滚 v1 均续接成功；K8s Deployment rollingUpdate 为正式滚动形态）
- [x] 升级后既有会话可从数据卷续接（verify-12：v1 写的会话，v2 镜像续接答出 apple——JSONL 跨版本兼容）
- [x] 容器内关闭自更新，版本由镜像控制（Dockerfile ENV PI_OFFLINE=1；verify-12 inspect 确认；版本完全由镜像 tag/ARG PI_VERSION 控制）
