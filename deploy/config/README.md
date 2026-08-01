# deploy/config — 平台运行配置

## pi/ — 平台 pi 配置（`POWERI_PI_CONFIG_DIR`，默认值）

`gen-pi-config` 的**默认输出目录**，也是 gateway seedUser（每用户播种 models.json/settings.json）、
`run-piweb`、`gen-k8s` 的**配置源**。

```bash
npm run gen:pi-config   # 读取 .env 的 POWERI_AI_* → 渲染 deploy/config/pi/{models.json,settings.json}
```

- 整个目录被 `.gitignore` 忽略：`models.json` 含模型 API 密钥，**不得提交**。
- 需要自定义位置时设 `POWERI_PI_CONFIG_DIR=<dir>`（gen-pi-config 输出 + 各消费方读取均遵循）。
- 平台配置放在项目内、**不污染宿主 `~/.pi/agent`**（那是用户个人 pi 配置，如 claude-cli 的 LITTA 配置）。
- 例外：`verify-08` Part A 用宿主 `~/.pi/agent`（容器直跑 pi 用用户本机真实模型，不依赖 poweri-gw）。
