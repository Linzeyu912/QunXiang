import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('流和受保护图片鉴权', () => {
  it('sse_uses_authorization_header_without_query_token', async () => {
    const sources = await Promise.all(['extraction.ts', 'stories.ts'].map((name) =>
      readFile(new URL(`./${name}`, import.meta.url), 'utf8')));

    expect(sources.join('\n')).not.toContain('access_token=');
    expect(sources.join('\n')).not.toContain('new EventSource');
    expect(sources.join('\n')).toContain('openAuthenticatedSse');
  });

  it('protected_image_uses_blob_url_and_revokes_it_on_cleanup', async () => {
    const source = await readFile(new URL('./images.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('access_token=');
    expect(source).toContain('URL.createObjectURL');
    expect(source).toContain('URL.revokeObjectURL');
  });

  it('导出下载使用鉴权 fetch 和 Blob URL，不直接导航到受保护接口', async () => {
    const [apiSource, pageSource] = await Promise.all([
      readFile(new URL('./export.ts', import.meta.url), 'utf8'),
      readFile(new URL('../pages/ExportPage.tsx', import.meta.url), 'utf8'),
    ]);
    expect(apiSource).toContain('apiFetch<Response>');
    expect(apiSource).toContain('URL.createObjectURL');
    expect(apiSource).toContain('URL.revokeObjectURL');
    expect(pageSource).not.toContain('window.location.href');
  });

  it('服务端只接受Authorization请求头且删除旧刷新接口', async () => {
    const [appSource, authSource] = await Promise.all([
      readFile(new URL('../../../api/src/app.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../../api/src/routes/auth.ts', import.meta.url), 'utf8'),
    ]);

    expect(appSource).not.toContain("get('access_token')");
    expect(authSource).not.toContain("fastify.post('/refresh'");
  });
});
