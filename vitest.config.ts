import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 匹配任意层级 src 下的测试（含 web/src、api/src、各 workspace 包），
    // 排除 node_modules 与 dist。原 '*/src/**' 只匹配一级子目录，较脆弱。
    include: ['**/src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts'],
    },
  },
})
