import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execAsync = promisify(exec)

// Generate a unique test database path
const testDbPath = join(tmpdir(), `novel-agent-test-${randomUUID()}.db`)
const testDbUrl = `file:${testDbPath}`

// Ensure tmpdir exists
mkdirSync(tmpdir(), { recursive: true })

// Push the Prisma schema to create tables in the test database
async function setupTestDatabase() {
  try {
    // Use npx to run prisma db push with our test database URL
    const { stderr } = await execAsync(
      `npx prisma db push --schema=./storage/prisma/schema.prisma --url="${testDbUrl}" --force-reset --skip-generate`,
      { cwd: process.cwd() }
    )
    if (stderr && !stderr.includes('info')) {
      console.warn('Prisma db push stderr:', stderr)
    }
    console.log('Test database initialized at:', testDbPath)
  } catch (error) {
    console.error('Failed to initialize test database:', error)
    throw error
  }
}

// Export for use in test files
export { testDbPath, testDbUrl }

// Initialize database before tests run
await setupTestDatabase()
