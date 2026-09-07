# 双远端同步

## 目的

合并完成后，`/Users/tianzhao/code/leoao/poweri` 是唯一开发工作区和 monorepo 事实源，同时维护两个代码内容一致、提交身份独立的远端：

- 内网 GitLab：`https://gitlab.litta.cn/litta-power/poweri.git`（`tianzhao@leoao.com`，主开发与 CI）
- 外网 GitHub：`https://github.com/cgoder/poweri.git`（`gcoder@live.com`，外部镜像与协作入口）

Git 的 author/email 属于 commit 对象，不能按 push URL 自动变化。因此两端必须使用不同的提交流：代码树保持一致，但 commit SHA 与历史可以不同。GitHub 不再作为独立 web 项目开发；禁止使用一个 multi-push URL 把同一个 commit 同时推到两端。

## 本地 remote 配置

保留两个独立 remote，避免误把 GitLab 身份提交推到 GitHub，或把 GitHub 身份提交推到 GitLab：

```bash
git remote set-url origin https://gitlab.litta.cn/litta-power/poweri.git
git remote set-url github https://github.com/cgoder/poweri.git
git config --unset-all remote.origin.pushurl 2>/dev/null || true
```

检查配置：

```bash
git remote -v
git ls-remote --heads origin
git ls-remote --heads github
```

凭据分别由 GitLab 与 GitHub 的本机 credential helper / SSH agent 提供，不得写入仓库、脚本或日志。

## 日常同步

每次变更都要先完成测试，再为两个远端生成独立 commit。推荐先在临时工作分支或独立 worktree 验证代码，然后按下面顺序同步同一棵代码树：

```bash
# 1. GitHub 提交流：在 GitHub 历史上产生 gcoder commit
GIT_AUTHOR_NAME='cgoder' GIT_AUTHOR_EMAIL='gcoder@live.com' \
GIT_COMMITTER_NAME='cgoder' GIT_COMMITTER_EMAIL='gcoder@live.com' \
git commit -m 'feat(...): ...'
git push github HEAD:main

# 2. GitLab 提交流：以 GitLab main 为父提交，只复用 GitHub commit 的 tree
#    不要 cherry-pick GitHub commit，否则会把不符合邮箱规则的历史带入 GitLab。
git fetch origin main
tree=$(git rev-parse HEAD^{tree})
parent=$(git rev-parse origin/main)
gitlab_commit=$(
  GIT_AUTHOR_NAME='田钊' GIT_AUTHOR_EMAIL='tianzhao@leoao.com' \
  GIT_COMMITTER_NAME='田钊' GIT_COMMITTER_EMAIL='tianzhao@leoao.com' \
  git commit-tree "$tree" -p "$parent" -m 'sync(...): mirror GitHub tree'
)
git branch -f gitlab-main "$gitlab_commit"
git push origin "$gitlab_commit:refs/heads/main"
```

实际操作中不要在同一分支上交替修改 `user.email` 后继续提交；应使用临时分支或独立 worktree 保存 GitHub 提交流，GitLab 快照则由 `git commit-tree` 直接生成。后续同步仍然以 GitHub 的已验证代码树为输入，GitLab 侧只新增一个以 `origin/main` 为父提交的 tianzhao 快照。

推送后必须核对两个远端的代码树和 ref：

```bash
git ls-remote https://gitlab.litta.cn/litta-power/poweri.git refs/heads/main
git ls-remote https://github.com/cgoder/poweri.git refs/heads/main

git diff origin/main github/main --exit-code
```

两个 ref 的 SHA 不同是预期结果；`git diff` 必须为空。任何远端失败都要停止后续同步，不得用 force push 掩盖分叉。

## 合并迁移特别说明

原 `github/cgoder/poweri` 是 web 迭代仓库。一次性归并其 web 内容后，GitHub 保留来源历史；GitLab 不能接受来源历史中不符合内网邮箱规则的 commit，因此首次同步在 GitLab 侧采用同树快照提交。快照只携带当前代码树，不改写来源项目原作者历史。

若任一远端出现非预期提交，先停止同步并人工审查；不得用 `git push --force` 覆盖远端历史。
