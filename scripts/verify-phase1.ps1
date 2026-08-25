$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Invoke-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    $failurePrefix = [Text.Encoding]::UTF8.GetString(
      [Convert]::FromBase64String('6aqM6K+B5ZG95Luk5aSx6LSl77ya')
    )
    throw "$failurePrefix$File $($Arguments -join ' ')"
  }
}

try {
  Invoke-Checked 'pnpm' @('test:postgres:up')

  if (-not $env:TEST_DATABASE_URL) {
    $env:TEST_DATABASE_URL = 'postgresql://qunxiang_test:qunxiang_test@127.0.0.1:55432/qunxiang_test'
  }

  $databaseSafetyMessage = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String('5q2j5Zyo5qCh6aqM5rWL6K+V5pWw5o2u5bqT5a6J5YWo6L6555WM')
  )
  Write-Host $databaseSafetyMessage
  Invoke-Checked 'pnpm' @('run', 'test:database:validate')

  $env:DATABASE_URL = $env:TEST_DATABASE_URL
  $env:DIRECT_DATABASE_URL = $env:TEST_DATABASE_URL
  $env:KEEP_TEST_DB = '1'
  Invoke-Checked 'pnpm' @('db:migrate:deploy')

  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DIRECT_DATABASE_URL -ErrorAction SilentlyContinue
  Invoke-Checked 'pnpm' @('test')
  Invoke-Checked 'pnpm' @('build')
  Invoke-Checked 'pnpm' @('check:workspace-deps')
  Invoke-Checked 'git' @('status', '--short')
} finally {
  Remove-Item Env:KEEP_TEST_DB -ErrorAction SilentlyContinue
  Invoke-Checked 'pnpm' @('test:postgres:down')
}
