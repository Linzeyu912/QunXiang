import { describe, expect, it } from 'vitest';
import { getExtractionStartGate } from './extractionGate';

describe('getExtractionStartGate', () => {
  it('blocks extraction while LLM status is still being checked', () => {
    const gate = getExtractionStartGate(undefined, true);

    expect(gate.canStart).toBe(false);
    expect(gate.reason).toBe('checking-llm');
    expect(gate.buttonLabel).toBe('检查 LLM');
  });

  it('blocks extraction and points users to settings when LLM cannot extract', () => {
    const gate = getExtractionStartGate({
      provider: 'none',
      configured: false,
      canExtract: false,
      error: 'Provider not configured',
    });

    expect(gate.canStart).toBe(false);
    expect(gate.reason).toBe('llm-not-configured');
    expect(gate.title).toBe('先配置 LLM 服务商');
    expect(gate.actionLabel).toBe('去设置');
  });

  it('allows extraction when the provider is ready', () => {
    const gate = getExtractionStartGate({
      provider: 'custom',
      configured: true,
      canExtract: true,
    });

    expect(gate.canStart).toBe(true);
    expect(gate.reason).toBeUndefined();
  });
});
