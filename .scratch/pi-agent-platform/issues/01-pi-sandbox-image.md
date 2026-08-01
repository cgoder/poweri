# 01 — pi 沙箱容器镜像

**What to build:** 一个可运行的 Worker Pod 基础镜像：基于 Node 运行时安装 pi（锁版本、`--ignore-scripts`），内置 bash/git/ripgrep 等 pi 内建工具的依赖，以非 root 用户运行，并默认关闭启动外呼（`PI_OFFLINE=1`）。跑起来后能独立执行一次 pi 请求。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `docker run` 该镜像后执行 `pi -p "<问题>"` 能返回模型输出
- [ ] 镜像内 pi 版本被锁定（可复现构建）
- [ ] 进程以非 root 用户运行
- [ ] `PI_OFFLINE=1` 生效（无 pi.dev 外呼）
- [ ] bash/git/ripgrep 工具在容器内可用
