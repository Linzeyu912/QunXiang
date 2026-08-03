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
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
    ],
  },
  {
    id: 'minimax-cn',
    name: 'MiniMax（国内）',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: [
      { id: 'MiniMax-M2', name: 'MiniMax M2' },
    ],
  },
  {
    id: 'minimax-intl',
    name: 'MiniMax（国际）',
    baseUrl: 'https://api.minimax.io/v1',
    models: [
      { id: 'MiniMax-M2', name: 'MiniMax M2' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
    ],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B' },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4-flash', name: 'GLM-4 Flash' },
      { id: 'glm-4-plus', name: 'GLM-4 Plus' },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K' },
      { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K' },
      { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K' },
    ],
  },
  {
    id: 'baidu',
    name: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: [
      { id: 'ernie-4.0-turbo-8k', name: 'ERNIE 4.0 Turbo' },
      { id: 'ernie-3.5-8k', name: 'ERNIE 3.5' },
    ],
  },
  {
    id: 'aliyun',
    name: '阿里通义',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-plus', name: 'Qwen Plus' },
      { id: 'qwen-turbo', name: 'Qwen Turbo' },
      { id: 'qwen-max', name: 'Qwen Max' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
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
