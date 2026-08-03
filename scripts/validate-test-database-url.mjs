import {
  assertSafeTestDatabaseUrl,
  collectProductionDatabaseUrls,
} from './test-database-url.mjs';

try {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const productionUrls = collectProductionDatabaseUrls(process.env, testDatabaseUrl);
  assertSafeTestDatabaseUrl(testDatabaseUrl, productionUrls);
} catch (error) {
  console.error('测试数据库安全校验失败：', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
