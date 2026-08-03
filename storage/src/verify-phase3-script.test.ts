import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '..', '..');
const scriptPath = resolve(workspaceRoot, 'scripts', 'verify-phase3.ps1');

describe('阶段三完成门脚本', () => {
  it('统一守卫外部命令并在测试前清除数据库连接覆盖', () => {
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain("$ErrorActionPreference = 'Stop'");
    expect(script).toContain('function Invoke-Checked');
    expect(script).toMatch(/try\s*\{[\s\S]*\}\s*finally\s*\{/);
    const clearDatabaseUrl = script.indexOf('Remove-Item Env:DATABASE_URL');
    const fullTest = script.indexOf("Invoke-Checked 'pnpm' @('test')");
    expect(clearDatabaseUrl).toBeGreaterThan(-1);
    expect(fullTest).toBeGreaterThan(clearDatabaseUrl);
    expect(script).toContain('test:postgres:up');
    expect(script).toContain('test:minio:up');
    expect(script).toContain("Invoke-Checked 'pnpm' @('test:postgres:down')");
    expect(script).not.toMatch(/&\s+(pnpm|git)\b/);
  });
});
