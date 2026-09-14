/**
 * 预设服务商注册表
 *
 * 用户只需「选服务商 → 选模型 → 填 API Key」即可完成配置，
 * 无需手动输入 baseUrl 和模型名称。
 */

export interface ProviderModel {
  id: string;
  name: string;
  /** 默认图片尺寸（Seedream/OpenAI 风格），选中模型时自动填充 */
  defaultSize?: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  models: ProviderModel[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ── 国内主流 ──
  {
    id: 'deepseek',
    name: 'DeepSeek（深度求索）',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat（推荐，自动指向最新 V4）' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro（最强）' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash（快速，高性价比）' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner（深度推理）' },
    ],
  },
  {
    id: 'aliyun',
    name: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus（推荐，均衡，1M 上下文）' },
      { id: 'qwen3.8-max', name: 'Qwen3.8 Max（最强）' },
      { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash（快速）' },
      { id: 'qwen-long', name: 'Qwen Long（长文本，经济）' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 AI（GLM）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3（推荐，旗舰）' },
      { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash（快速，低价）' },
      { id: 'glm-5.2', name: 'GLM-5.2（上一代旗舰）' },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot（Kimi）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k3', name: 'Kimi K3（旗舰，1M 上下文，需充值解锁）' },
      { id: 'kimi-k2.6', name: 'Kimi K2.6（推荐，262K 上下文）' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5' },
    ],
  },
  {
    id: 'kimi-token-plan',
    name: 'Kimi 订阅（Token Plan 专属端点）',
    baseUrl: 'https://api.kimi.com/coding/v1',
    models: [
      { id: 'kimi-k3', name: 'Kimi K3（旗舰，1M 上下文）' },
    ],
  },
  {
    id: 'baidu',
    name: '百度文心一言',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: [
      { id: 'ernie-4.0-turbo-8k', name: 'ERNIE 4.0 Turbo' },
      { id: 'ernie-3.5-8k', name: 'ERNIE 3.5' },
      { id: 'ernie-speed-8k', name: 'ERNIE Speed（快速）' },
    ],
  },
  {
    id: 'xunfei',
    name: '讯飞星火',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    models: [
      { id: 'generalv3.5', name: '星火 V3.5' },
      { id: 'generalv3', name: '星火 V3.0' },
    ],
  },
  {
    id: 'minimax-cn',
    name: 'MiniMax（国内）',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: [
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7（推荐，1M 上下文）' },
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 高速版（同效果，速度更快）' },
      { id: 'MiniMax-M2', name: 'MiniMax M2（历史版本）' },
    ],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow（聚合）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B' },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' },
      { id: 'THUDM/glm-4-9b-chat', name: 'GLM-4 9B' },
    ],
  },
  // ── 国际主流 ──
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.5', name: 'GPT-5.5（推荐）' },
      { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro（最强）' },
      { id: 'gpt-5.4', name: 'GPT-5.4（标准）' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini（经济）' },
      { id: 'gpt-5.2', name: 'GPT-5.2（上一代）' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic（Claude）',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5（推荐）' },
      { id: 'claude-opus-5', name: 'Claude Opus 5（最强）' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5（快速，经济）' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8（上一代）' },
    ],
  },
  {
    id: 'google',
    name: 'Google（Gemini）',
    // 注意：必须用 OpenAI 兼容端点（/v1beta/openai），原生 /v1beta 路径不支持 chat/completions
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash（推荐，Pro 级能力 + Flash 速度）' },
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro（最强）' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash（新一代快速）' },
    ],
  },
  {
    id: 'minimax-intl',
    name: 'MiniMax（国际）',
    baseUrl: 'https://api.minimax.io/v1',
    models: [
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7（推荐，1M 上下文）' },
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 高速版（同效果，速度更快）' },
    ],
  },
];

// ── 文生图预设 ──

export const IMAGE_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'reve',
    name: 'Reve',
    baseUrl: 'https://api.reve.com/v1/image/create',
    models: [
      { id: 'reve/create-image', name: 'Reve Create Image' },
    ],
  },
  {
    id: 'openai-image',
    name: 'OpenAI (DALL-E)',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'dall-e-3', name: 'DALL-E 3', defaultSize: '1024x1024' },
      { id: 'gpt-image-1', name: 'GPT Image 1', defaultSize: '1024x1024' },
    ],
  },
  {
    id: 'siliconflow-image',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 Schnell', defaultSize: '1024x1024' },
      { id: 'stabilityai/stable-diffusion-3-5-large', name: 'SD 3.5 Large', defaultSize: '1024x1024' },
      { id: 'Kwai-Kolors/Kolors', name: 'Kolors (快手)', defaultSize: '1024x1024' },
    ],
  },
  {
    id: 'aimlapi',
    name: 'aimlapi',
    baseUrl: 'https://api.aimlapi.com/v1',
    models: [
      { id: 'dall-e-3', name: 'DALL-E 3', defaultSize: '1024x1024' },
      { id: 'stabilityai/stable-diffusion-3', name: 'Stable Diffusion 3', defaultSize: '1024x1024' },
      { id: 'black-forest-labs/flux-1.1-pro', name: 'FLUX 1.1 Pro', defaultSize: '1024x1024' },
    ],
  },
  {
    id: 'zhipu-image',
    name: '智谱 AI (CogView)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'cogview-4', name: 'CogView 4', defaultSize: '1024x1024' },
      { id: 'cogview-3-flash', name: 'CogView 3 Flash', defaultSize: '1024x1024' },
    ],
  },
  {
    id: 'aliyun-image',
    name: '阿里通义 (文生图)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'wanx-v1', name: '通义万相', defaultSize: '1024x1024' },
    ],
  },
  {
    id: 'volcengine-image',
    name: '火山引擎 (豆包 Seedream)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream 5.0 Pro', defaultSize: '2K' },
    ],
  },
];
