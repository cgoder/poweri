// PowerI 环境配置校验（fail-fast）
// 用法：npm run validate:env（内部用 node --env-file-if-exists=.env 加载）
// 校验失败时打印错误并以非零码退出，避免带病运行。

const errors = [];

// 模型凭据：至少设置一个 API key（内置 provider 或自建 AI 网关）
const MODEL_KEYS = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY',
  'MISTRAL_API_KEY', 'XAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'HF_TOKEN',
  'POWERI_AI_API_KEY',
];
if (!MODEL_KEYS.some((k) => process.env[k])) {
  errors.push('缺少模型凭据：需设置至少一个 “…_API_KEY”，或自建网关 POWERI_AI_API_KEY（见 .env.example）');
}

// 自建 AI 网关：若使用了 POWERI_AI_*，则 baseUrl/model/key 必须齐全
if (process.env.POWERI_AI_API_KEY || process.env.POWERI_AI_BASE_URL || process.env.POWERI_AI_MODEL) {
  if (!process.env.POWERI_AI_BASE_URL) errors.push('POWERI_AI_BASE_URL 未设置（自建网关必填）');
  if (!process.env.POWERI_AI_API_KEY) errors.push('POWERI_AI_API_KEY 未设置（自建网关必填）');
  if (!process.env.POWERI_AI_MODEL) errors.push('POWERI_AI_MODEL 未设置（自建网关必填）');
  if (process.env.POWERI_AI_THINKING && !['on', 'off', 'true', 'false', '1', '0'].includes(process.env.POWERI_AI_THINKING.toLowerCase())) {
    errors.push(`POWERI_AI_THINKING 非法: “${process.env.POWERI_AI_THINKING}”（允许 on/off）`);
  }
  if (process.env.POWERI_AI_THINKING_LEVEL && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(process.env.POWERI_AI_THINKING_LEVEL.toLowerCase())) {
    errors.push(`POWERI_AI_THINKING_LEVEL 非法: “${process.env.POWERI_AI_THINKING_LEVEL}”（允许 off/minimal/low/medium/high/xhigh/max）`);
  }
}

// PI_OFFLINE 允许 0/1/true/false/空
if (process.env.PI_OFFLINE && !['0', '1', 'true', 'false'].includes(process.env.PI_OFFLINE.toLowerCase())) {
  errors.push(`PI_OFFLINE 值非法: "${process.env.PI_OFFLINE}"（允许 0/1/true/false）`);
}

// 端口必须是 1-65535 的整数
for (const k of ['POWERI_GATEWAY_PORT', 'POWERI_BRIDGE_PORT']) {
  if (process.env[k]) {
    const n = Number(process.env[k]);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      errors.push(`${k} 非法: "${process.env[k]}"（须为 1-65535 的整数）`);
    }
  }
}

if (errors.length) {
  console.error('❌ 环境配置校验失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('✅ 环境配置校验通过');
