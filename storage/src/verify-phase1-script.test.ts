import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const workspaceRoot = resolve(import.meta.dirname, '..', '..')
const scriptPath = resolve(workspaceRoot, 'scripts', 'verify-phase1.ps1')
const validatorPath = resolve(workspaceRoot, 'scripts', 'validate-test-database-url.mjs')

function withoutDatabaseOverrides(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => ![
    'test_database_url',
    'database_url',
    'direct_database_url',
    'production_database_url',
    'production_database_urls',
  ].includes(key.toLowerCase())))
}

describe('阶段一完成门脚本', () => {
  it('统一守卫外部命令，并在测试前清除数据库连接覆盖', () => {
    const script = readFileSync(scriptPath, 'utf8')

    expect(script).toContain("$ErrorActionPreference = 'Stop'")
    expect(script).toContain('function Invoke-Checked')
    expect(script).toMatch(/try\s*\{[\s\S]*\}\s*finally\s*\{/)

    const clearDatabaseUrl = script.indexOf('Remove-Item Env:DATABASE_URL')
    const clearDirectDatabaseUrl = script.indexOf('Remove-Item Env:DIRECT_DATABASE_URL')
    const fullTest = script.indexOf("Invoke-Checked 'pnpm' @('test')")
    expect(clearDatabaseUrl).toBeGreaterThan(-1)
    expect(clearDirectDatabaseUrl).toBeGreaterThan(-1)
    expect(fullTest).toBeGreaterThan(clearDatabaseUrl)
    expect(fullTest).toBeGreaterThan(clearDirectDatabaseUrl)

    expect(script).toContain("Invoke-Checked 'pnpm' @('test:postgres:down')")
    expect(script).not.toMatch(/&\s+(pnpm|git)\b/)

    const safetyCheck = script.indexOf("Invoke-Checked 'pnpm' @('run', 'test:database:validate')")
    const migrate = script.indexOf("Invoke-Checked 'pnpm' @('db:migrate:deploy')")
    expect(safetyCheck).toBeGreaterThan(-1)
    expect(migrate).toBeGreaterThan(safetyCheck)
  })

  it('中途命令失败后停止后续验证，但 finally 仍清理数据库', () => {
    const tempDirectory = mkdtempSync(resolve(tmpdir(), 'phase1-gate-'))
    const callLog = resolve(tempDirectory, 'calls.log')
    const pnpmShim = resolve(tempDirectory, 'pnpm.cmd')
    const gitShim = resolve(tempDirectory, 'git.cmd')

    writeFileSync(
      pnpmShim,
      [
        '@echo off',
        'echo pnpm %*>>"%VERIFY_PHASE1_CALL_LOG%"',
        'if "%1"=="db:migrate:deploy" exit /b 23',
        'exit /b 0',
      ].join('\r\n'),
      'utf8',
    )
    writeFileSync(
      gitShim,
      ['@echo off', 'echo git %*>>"%VERIFY_PHASE1_CALL_LOG%"', 'exit /b 0'].join('\r\n'),
      'utf8',
    )

    try {
      const result = spawnSync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        {
          cwd: workspaceRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${tempDirectory}${delimiter}${process.env.PATH ?? ''}`,
            VERIFY_PHASE1_CALL_LOG: callLog,
          },
        },
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('验证命令失败：pnpm db:migrate:deploy')
      expect(readFileSync(callLog, 'utf8').trim().split(/\r?\n/)).toEqual([
        'pnpm test:postgres:up',
        'pnpm run test:database:validate',
        'pnpm db:migrate:deploy',
        'pnpm test:postgres:down',
      ])
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('不安全测试库地址在迁移前被拒绝且仍执行清理', () => {
    const tempDirectory = mkdtempSync(resolve(tmpdir(), 'phase1-unsafe-db-'))
    const callLog = resolve(tempDirectory, 'calls.log')
    const pnpmShim = resolve(tempDirectory, 'pnpm.cmd')
    const gitShim = resolve(tempDirectory, 'git.cmd')

    writeFileSync(
      pnpmShim,
      [
        '@echo off',
        'echo pnpm %*>>"%VERIFY_PHASE1_CALL_LOG%"',
        'if "%1 %2"=="run test:database:validate" exit /b 24',
        'exit /b 0',
      ].join('\r\n'),
      'utf8',
    )
    writeFileSync(gitShim, ['@echo off', 'exit /b 0'].join('\r\n'), 'utf8')

    try {
      const result = spawnSync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        {
          cwd: workspaceRoot,
          encoding: 'utf8',
          env: {
            ...withoutDatabaseOverrides(),
            PATH: `${tempDirectory}${delimiter}${process.env.PATH ?? ''}`,
            TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/qunxiang',
            DATABASE_URL: '',
            DIRECT_DATABASE_URL: '',
            VERIFY_PHASE1_CALL_LOG: callLog,
          },
        },
      )

      const calls = readFileSync(callLog, 'utf8').trim().split(/\r?\n/)
      expect(calls, `${result.stdout}\n${result.stderr}`).toEqual([
        'pnpm test:postgres:up',
        'pnpm run test:database:validate',
        'pnpm test:postgres:down',
      ])
      expect(result.status, `${result.stdout}\n${result.stderr}\n${calls.join('\n')}`).not.toBe(0)
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('数据库安全校验入口真实拒绝非测试库', () => {
    const result = spawnSync(process.execPath, [validatorPath], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: {
        ...withoutDatabaseOverrides(),
        TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/qunxiang',
      },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('测试数据库名称必须以 _test 结尾')
  })

  it('Windows PowerShell 能执行 Git 按 CRLF 检出的脚本', () => {
    const tempDirectory = mkdtempSync(resolve(tmpdir(), 'phase1-crlf-'))
    const callLog = resolve(tempDirectory, 'calls.log')
    const crlfScript = resolve(tempDirectory, 'verify-phase1.ps1')
    const pnpmShim = resolve(tempDirectory, 'pnpm.cmd')
    const gitShim = resolve(tempDirectory, 'git.cmd')

    writeFileSync(
      crlfScript,
      readFileSync(scriptPath, 'utf8').replace(/\r?\n/g, '\r\n'),
      'utf8',
    )
    writeFileSync(
      pnpmShim,
      ['@echo off', 'echo pnpm %*>>"%VERIFY_PHASE1_CALL_LOG%"', 'exit /b 0'].join('\r\n'),
      'utf8',
    )
    writeFileSync(
      gitShim,
      ['@echo off', 'echo git %*>>"%VERIFY_PHASE1_CALL_LOG%"', 'exit /b 0'].join('\r\n'),
      'utf8',
    )

    try {
      const result = spawnSync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', crlfScript],
        {
          cwd: workspaceRoot,
          encoding: 'utf8',
          env: {
            ...withoutDatabaseOverrides(),
            PATH: `${tempDirectory}${delimiter}${process.env.PATH ?? ''}`,
            VERIFY_PHASE1_CALL_LOG: callLog,
          },
        },
      )

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain('正在校验测试数据库安全边界')
      expect(readFileSync(callLog, 'utf8').trim().split(/\r?\n/)).toEqual([
        'pnpm test:postgres:up',
        'pnpm run test:database:validate',
        'pnpm db:migrate:deploy',
        'pnpm test',
        'pnpm build',
        'pnpm check:workspace-deps',
        'git status --short',
        'pnpm test:postgres:down',
      ])
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })
})
