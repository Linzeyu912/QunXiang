import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const API_TARGET = process.env.VITE_API_URL || 'http://localhost:3000';

const API_PREFIXES = ['/books', '/characters', '/locations', '/items', '/export', '/health', '/auth'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [
        p,
        {
          target: API_TARGET,
          changeOrigin: true,
          ws: false,
          // SPA 路由与 API 前缀重叠（如 /books/:id/characters 既是页面又是接口）。
          // 地址栏直达 / F5 刷新发出的是 HTML 文档请求，绕过代理回落到 SPA；
          // 只有 fetch/XHR（Accept 非 text/html）才转发给 API。
          bypass: (req: { headers: Record<string, string | string[] | undefined> }) => {
            const accept = req.headers.accept;
            const acceptStr = Array.isArray(accept) ? accept.join(',') : accept;
            return acceptStr?.includes('text/html') ? '/index.html' : undefined;
          },
        },
      ]),
    ),
  },
  build: {
    outDir: 'dist',
    // 生成 sourcemap 便于线上排错，但不在产物里写 sourceMappingURL 引用，
    // 避免把源码直接暴露给公网用户。需要时可上传到错误监控平台解码。
    sourcemap: 'hidden',
  },
});
