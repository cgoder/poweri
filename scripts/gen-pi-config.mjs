// PowerI → pi 配置生成器
// 把 .env 里的自建 AI 网关参数渲染成 pi 的 models.json / settings.json。
// 背景：pi 的 models.json 只对 apiKey 支持 $ENV 插值，baseUrl/模型 id 需字面量，
// 故用本脚本把 .env 作为唯一来源，生成 pi 实际读取的配置文件。
// 用法：npm run gen:pi-config   （内部 node --env-file-if-exists=.env）
// 目标目录默认 <项目根>/deploy/config/pi/（平台配置放项目内，不污染宿主 ~/.pi/agent），可用 POWERI_PI_CONFIG_DIR 覆盖。

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const ON_VALUES = ['on', 'true', '1'];

const baseUrl = process.env.POWERI_AI_BASE_URL;
const apiKey = process.env.POWERI_AI_API_KEY;
const model = process.env.POWERI_AI_MODEL;
const thinking = (process.env.POWERI_AI_THINKING ?? 'on').toLowerCase();
const thinkingLevel = (process.env.POWERI_AI_THINKING_LEVEL ?? 'off').toLowerCase();

const errors = [];
if (!baseUrl) errors.push('POWERI_AI_BASE_URL 未设置');
if (!apiKey) errors.push('POWERI_AI_API_KEY 未设置');
if (!model) errors.push('POWERI_AI_MODEL 未设置');
if (![...ON_VALUES, 'off', 'false', '0'].includes(thinking)) errors.push(`POWERI_AI_THINKING 非法: "${thinking}"（允许 on/off）`);
if (!THINKING_LEVELS.includes(thinkingLevel)) errors.push(`POWERI_AI_THINKING_LEVEL 非法: "${thinkingLevel}"（允许 ${THINKING_LEVELS.join('/')}）`);
if (errors.length) {
  console.error('❌ 无法生成 pi 配置：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

const reasoning = ON_VALUES.includes(thinking);

// apiKey 写入形式：默认字面量（docker PoC 零依赖）；POWERI_PI_CONFIG_APIKEY_REF=1 时写 $POWERI_AI_API_KEY 环境引用
// （pi 原生 $ENV 插值）→ 配置不含明文密钥，运行时由 K8s Secret / 容器 env 注入（ticket 19）
const apiKeyOut = process.env.POWERI_PI_CONFIG_APIKEY_REF === "1" ? "$POWERI_AI_API_KEY" : apiKey;

const modelsJson = {
  providers: {
    'poweri-gw': {
      baseUrl,
      api: 'openai-completions',
      apiKey: apiKeyOut,
      models: [
        {
          id: model,
          reasoning,
          ...(reasoning ? { compat: { supportsReasoningEffort: true } } : {}),
        },
      ],
    },
  },
};

const settingsJson = { defaultThinkingLevel: thinkingLevel };

const dir = process.env.POWERI_PI_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'config', 'pi');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'models.json'), JSON.stringify(modelsJson, null, 2) + '\n');
await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settingsJson, null, 2) + '\n');

console.log('✅ pi 配置已生成到 ' + dir);
console.log(`   模型: poweri-gw/${model}`);
console.log(`   思考: ${reasoning ? 'on' : 'off'} | 默认等级: ${thinkingLevel}`);
console.log(`   apiKey: ${apiKeyOut === '$POWERI_AI_API_KEY' ? '环境引用 $POWERI_AI_API_KEY（运行时注入）' : '字面量'}`);
