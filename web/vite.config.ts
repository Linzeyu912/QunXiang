import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// 默认 3001：本机 3000 常被其他项目（如 Omnitunes）占用，api/.env 的 PORT 也固定为 3001。
const API_TARGET = process.env.VITE_API_URL || 'http://localhost:3001';

// 与 api/src/app.ts 的路由前缀保持一致；漏配的前缀不会走代理，
// 会以 404/HTML 的形式落到 vite（曾导致 /account 轮换分享码、/shares 404）。
const API_PREFIXES = ['/books', '/characters', '/locations', '/items', '/export', '/health', '/auth', '/account', '/shares', '/public-assets'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      ...Object.fromEntries(
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
      // 对象下载签名地址是裸路径 /objects/dl?t=<token>，前端通过 <a href> 直接导航
      // （Accept: text/html），不能套用上面的 HTML 绕过，否则会被 SPA 的 404 页接住。
      '/objects': {
        target: API_TARGET,
        changeOrigin: true,
        ws: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // 生成 sourcemap 便于线上排错，但不在产物里写 sourceMappingURL 引用，
    // 避免把源码直接暴露给公网用户。需要时可上传到错误监控平台解码。
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // 第三方依赖单独分包：框架/库代码稳定、改动少，拆出后可被浏览器长期缓存，
        // 业务代码更新时用户只需重新下载变化的小包。
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-radix': [
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-radio-group',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
        },
      },
    },
  },
});
