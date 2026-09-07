# 双远端同步

## 目的

合并完成后，`/Users/tianzhao/code/leoao/poweri` 是唯一开发工作区和 monorepo 事实源，同时把同一组分支推送到：

- 内网 GitLab：`https://gitlab.litta.cn/litta-power/poweri.git`（主开发与 CI）
- 外网 GitHub：`https://github.com/cgoder/poweri.git`（同步镜像与外部协作入口）

GitHub 不再作为独立 web 项目开发。任何新提交都应先在 monorepo 完成，再双推；禁止在两个远端分别开发后再双向合并。

## 本地 remote 配置

`origin` 的 fetch 保持指向内网 GitLab；为 `origin` 配置多个 push URL，使一次 `git push origin <ref>` 同时推送两个远端：

```bash
git remote set-url origin https://gitlab.litta.cn/litta-power/poweri.git
git remote set-url --add --push origin https://gitlab.litta.cn/litta-power/poweri.git
git remote set-url --add --push origin https://github.com/cgoder/poweri.git
```

检查配置：

```bash
git remote -v
git config --get-all remote.origin.pushurl
git ls-remote --heads origin
```

凭据分别由 GitLab 与 GitHub 的本机 credential helper / SSH agent 提供，不得写入仓库、脚本或日志。

## 日常同步

从 monorepo 工作区完成测试后，按同名分支双推：

```bash
git push origin main
git push origin dev
```

发布 tag 时显式推送 tag：

```bash
git push origin <tag>
```

推送后核对两个远端的 ref：

```bash
git ls-remote https://gitlab.litta.cn/litta-power/poweri.git refs/heads/main

git ls-remote https://github.com/cgoder/poweri.git refs/heads/main
```

## 合并迁移特别说明

原 `github/cgoder/poweri` 是 web 迭代仓库。一次性归并其 web 内容后，目标 monorepo 的合并提交通过 `--allow-unrelated-histories -s ours` 保留旧 GitHub 历史为父提交；这样新 monorepo 树可以在不 force push 的情况下推进 GitHub `main`。

若 GitHub 远端出现非预期提交，先停止双推并人工审查；不得用 `git push --force` 覆盖远端历史。
