import type { LlmStatus } from '../types';

type LlmGateStatus = Pick<LlmStatus, 'provider' | 'configured' | 'canExtract' | 'error'>;

export type ExtractionStartGateReason = 'checking-llm' | 'llm-not-configured';

export interface ExtractionStartGate {
  canStart: boolean;
  reason?: ExtractionStartGateReason;
  title?: string;
  description?: string;
  actionLabel?: string;
  buttonLabel?: string;
}

export function getExtractionStartGate(status: LlmGateStatus | undefined, isLoading = false): ExtractionStartGate {
  if (isLoading || !status) {
    return {
      canStart: false,
      reason: 'checking-llm',
      title: '正在检查 LLM 配置',
      description: '确认服务商就绪后才能开始提取。',
      actionLabel: '去设置',
      buttonLabel: '检查 LLM',
    };
  }

  if (!status.canExtract) {
    const provider = status.provider && status.provider !== 'none' ? `当前服务商：${status.provider}。` : '';
    return {
      canStart: false,
      reason: 'llm-not-configured',
      title: '先配置 LLM 服务商',
      description: `${provider}提取需要可用的 LLM 服务商和 API 密钥。`,
      actionLabel: '去设置',
      buttonLabel: '配置 LLM',
    };
  }

  return { canStart: true };
}
