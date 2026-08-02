#!/bin/sh
# jmfederico/pi-web 分裂进程：sessiond 后台（会话守护，浏览器断开继续跑），web 前台
# sessiond 死亡则自杀让 Pod 重启（否则 web 探针活着但会话保证已失效）
set -e
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$PI_WEB_DATA_DIR"
pi-web-sessiond &
SD=$!
( wait "$SD" && kill -TERM $$ 2>/dev/null ) &
exec pi-web-server
