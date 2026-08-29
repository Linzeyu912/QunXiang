import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/src/**/*.test.{ts,tsx}'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // 全局 setup：任何测试文件只要 import 了 @qunxiang/storage 的 prisma，
    // 必须先指向含 test 的库名，否则直接失败——防误清生产/开发库
    setupFiles: ['./test/ensure-test-db.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts'],
    },
  },
})
