const DEFAULT_POSTGRES_PORT = '5432';

function parseDatabaseUrl(value, label) {
  if (!value) {
    throw new Error(`${label}未配置`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}格式无效`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${label}必须使用 PostgreSQL`);
  }
  return parsed;
}

function normalizedUrl(value) {
  const parsed = parseDatabaseUrl(value, '数据库地址');
  parsed.protocol = 'postgresql:';
  if (!parsed.port) parsed.port = DEFAULT_POSTGRES_PORT;
  return parsed.toString();
}

function endpoint(value) {
  const parsed = parseDatabaseUrl(value, '正式数据库地址');
  return `${parsed.hostname.toLowerCase()}:${parsed.port || DEFAULT_POSTGRES_PORT}`;
}

/** 收集测试进程覆盖变量前的正式数据库拒绝清单。 */
export function collectProductionDatabaseUrls(env, testDatabaseUrl) {
  const values = [
    env.PRODUCTION_DATABASE_URL,
    ...(env.PRODUCTION_DATABASE_URLS ?? '').split(','),
  ];

  for (const key of ['DATABASE_URL', 'DIRECT_DATABASE_URL']) {
    const value = env[key];
    if (!value) continue;
    if (testDatabaseUrl) {
      try {
        if (normalizedUrl(value) === normalizedUrl(testDatabaseUrl)) continue;
      } catch {
        // 无效地址仍加入清单，后续给出明确错误。
      }
    }
    values.push(value);
  }

  return values.map((value) => value?.trim()).filter(Boolean);
}

/** 在任何 generate/reset 前验证测试库不会指向正式资源。 */
export function assertSafeTestDatabaseUrl(value, productionUrls = []) {
  if (!value) {
    throw new Error('未配置测试数据库地址');
  }
  const testUrl = parseDatabaseUrl(value, '测试数据库地址');
  const databaseName = decodeURIComponent(testUrl.pathname.replace(/^\//, ''));
  if (!databaseName.endsWith('_test')) {
    throw new Error('测试数据库名称必须以 _test 结尾');
  }

  const testNormalized = normalizedUrl(value);
  const testEndpoint = endpoint(value);
  for (const productionUrl of productionUrls) {
    if (normalizedUrl(productionUrl) === testNormalized) {
      throw new Error('测试数据库不得与正式数据库相同');
    }
    if (endpoint(productionUrl) === testEndpoint) {
      throw new Error('测试数据库不得与正式数据库共用主机和端口');
    }
  }

  return testUrl;
}
