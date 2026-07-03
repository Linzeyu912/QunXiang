import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('startup LLM defaults', () => {
  it('does not mark a fresh normal setup as mock-configured', () => {
    for (const path of ['api/.env.example', 'setup.bat', 'start.bat']) {
      const content = readRepoFile(path);
      expect(content, path).not.toMatch(/^echo LLM_PROVIDER=mock$/m);
      expect(content, path).not.toMatch(/^LLM_PROVIDER=mock$/m);
    }
  });

  it('keeps mock mode isolated to the explicit mock startup script', () => {
    expect(readRepoFile('start-mock.bat')).toMatch(/^echo LLM_PROVIDER=mock$/m);
  });

  it('does not expose local-model provider configuration in user-facing surfaces', () => {
    const paths = [
      'api/.env.example',
      'README.md',
      'docs/web-extraction-artifacts-frontend.md',
      'web/src/api/llm.ts',
      'web/src/pages/LlmSettingsPage.tsx',
    ];

    for (const path of paths) {
      const content = readRepoFile(path);
      expect(content, path).not.toMatch(/\bollama\b/i);
      expect(content, path).not.toMatch(/本地模型/);
      expect(content, path).not.toMatch(/OLLAMA_/);
    }
  });

  it('keeps the runtime config endpoint limited to the API provider', () => {
    const content = readRepoFile('api/src/routes/health.ts');

    expect(content).toContain("provider?: 'custom'");
    expect(content).toContain('Missing required field: provider (custom)');
    expect(content).toContain('Invalid provider. Must be "custom".');
    expect(content).not.toContain("'ollama' | 'custom' | 'mock'");
    expect(content).not.toContain("['ollama', 'custom', 'mock']");
  });

  it('does not auto-detect local model providers in the LLM factory', () => {
    const content = readRepoFile('llm/src/factory.ts');

    expect(content).not.toMatch(/createOllamaProvider/);
    expect(content).not.toMatch(/OLLAMA_/);
    expect(content).not.toMatch(/auto-detect/i);
  });
});
