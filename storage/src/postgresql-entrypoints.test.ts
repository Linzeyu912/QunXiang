import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);

async function readRootFile(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8');
}

describe('PostgreSQL 启动入口', () => {
  it.each(['setup.bat', 'start.bat', 'start-mock.bat'])(
    '%s 只使用 PostgreSQL 正式迁移',
    async (file) => {
      const content = await readRootFile(file);
      expect(content).toContain('set "DB_URL=postgresql://');
      expect(content).toContain('echo DATABASE_URL=!DB_URL!');
      expect(content).toContain('DIRECT_DATABASE_URL=');
      expect(content).toContain('prisma migrate deploy');
      expect(content).toContain('findstr /B /I /C:"DATABASE_URL=file:"');
      expect(content).toContain('检测到旧版 SQLite 配置。为避免数据丢失，脚本不会自动覆盖');
      expect(content).toContain('缺少 DIRECT_DATABASE_URL');
      expect(content).not.toMatch(/echo DATABASE_URL=file:/i);
      expect(content).not.toContain('prisma db push');
      expect(content).not.toContain('%API_DIR%.env');
    },
  );

  it('README 不再指导使用 SQLite 或 db push 启动正式应用', async () => {
    const content = await readRootFile('README.md');
    expect(content).toContain('pnpm db:migrate:deploy');
    expect(content).not.toContain('DATABASE_URL=file:');
    expect(content).not.toContain('pnpm db:push');
  });
});
