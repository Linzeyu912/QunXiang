import { mkdtemp, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadProfilesFromDisk,
  saveConfigToDisk,
  saveProfilesToDisk,
  type LlmProfile,
  type RuntimeLlmConfig,
} from './configStore.js';

describe('群像加密模型配置目录', () => {
  it('优先使用环境变量指定的共享配置目录', async () => {
    const source = await readFile(new URL('./configStore.ts', import.meta.url), 'utf8');

    expect(source).toContain('QUNXIANG_CONFIG_DIR');
    expect(source).toMatch(/process\.env\.QUNXIANG_CONFIG_DIR[\s\S]*getProjectRoot\(\)/);
  });

  it('新文件名统一使用群像，并兼容读取旧配置', async () => {
    const source = await readFile(new URL('./configStore.ts', import.meta.url), 'utf8');

    expect(source).toContain('.qunxiang-config.encrypted');
    expect(source).toContain('getLegacyConfigPath');
  });
});

describe('多档案配置持久化（v2）', () => {
  let configDir: string;

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'qunxiang-config-test-'));
    process.env.QUNXIANG_CONFIG_DIR = configDir;
    // 固定密钥，避免 vitest 环境走 getMasterSecret 的临时生成分支
    process.env.KEY_VAULTS_SECRET = 'test-secret-for-profiles-roundtrip';
  });

  afterAll(async () => {
    delete process.env.QUNXIANG_CONFIG_DIR;
    delete process.env.KEY_VAULTS_SECRET;
    await rm(configDir, { recursive: true, force: true });
  });

  const profiles: LlmProfile[] = [
    { id: 'p-kimi', name: 'Kimi 订阅', baseUrl: 'https://api.kimi.com/coding/v1', model: 'kimi-k3', apiKeys: ['sk-key-1', 'sk-key-2'], thinking: 'high' },
    { id: 'p-deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKeys: ['sk-key-3'] },
  ];

  it('saveProfilesToDisk → loadProfilesFromDisk 完整往返', () => {
    saveProfilesToDisk(profiles, 'p-deepseek');

    const loaded = loadProfilesFromDisk();
    expect(loaded).not.toBeNull();
    expect(loaded!.activeProfileId).toBe('p-deepseek');
    expect(loaded!.profiles).toHaveLength(2);
    const kimi = loaded!.profiles.find((p) => p.id === 'p-kimi')!;
    expect(kimi.name).toBe('Kimi 订阅');
    expect(kimi.baseUrl).toBe('https://api.kimi.com/coding/v1');
    expect(kimi.model).toBe('kimi-k3');
    expect(kimi.apiKeys).toEqual(['sk-key-1', 'sk-key-2']);
    expect(kimi.thinking).toBe('high');
    const deepseek = loaded!.profiles.find((p) => p.id === 'p-deepseek')!;
    expect(deepseek.apiKeys).toEqual(['sk-key-3']);
    expect(deepseek.thinking).toBeUndefined();
  });

  it('无 key 的档案往返保留（keyCount=0，不写加密 key 字段）', () => {
    saveProfilesToDisk([{ id: 'p-empty', name: '未填密钥' }], 'p-empty');
    const loaded = loadProfilesFromDisk();
    expect(loaded!.profiles[0].apiKeys).toBeUndefined();
  });

  it('v1 单配置文件自动迁移为「默认配置」档案', () => {
    const v1: RuntimeLlmConfig = {
      provider: 'custom',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKeys: ['sk-legacy-key'],
      thinking: 'off',
    };
    saveConfigToDisk(v1);

    const loaded = loadProfilesFromDisk();
    expect(loaded).not.toBeNull();
    expect(loaded!.activeProfileId).toBe('default');
    expect(loaded!.profiles).toHaveLength(1);
    expect(loaded!.profiles[0]).toMatchObject({
      id: 'default',
      name: '默认配置',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      thinking: 'off',
    });
    expect(loaded!.profiles[0].apiKeys).toEqual(['sk-legacy-key']);
  });

  it('activeProfileId 指向不存在的档案时回退到第一个', () => {
    saveProfilesToDisk(profiles, 'p-not-exist');
    const loaded = loadProfilesFromDisk();
    expect(loaded!.activeProfileId).toBe('p-kimi');
  });
});
