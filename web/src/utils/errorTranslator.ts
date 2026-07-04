/**
 * 将后端/网络错误翻译成普通用户能理解的中文提示
 */

interface ErrorRule {
  test: RegExp | string;
  message: string;
}

const uploadRules: ErrorRule[] = [
  // 文件大小（精确匹配，避免误伤包含 limit 的其他错误）
  { test: /413|payload too large|payload.*too large|entity too large|request entity too large/i, message: '文件太大了，请上传 50MB 以内的 TXT 文件' },
  { test: /fileSize|file too large|exceeds.*size|size limit exceeded/i, message: '文件太大了，请上传 50MB 以内的 TXT 文件' },

  // 文件缺失
  { test: /no file uploaded|missing file|multipart/i, message: '未检测到文件，请重新选择 TXT 文件上传' },

  // 编码/内容问题
  { test: /utf-?8|encoding|invalid character/i, message: '文件编码格式不正确，请保存为 UTF-8 编码的 TXT 文件' },
  { test: /empty|content is empty|blank/i, message: '文件内容为空，请检查文件后再上传' },

  // 解析问题（parseTxt 相关）
  { test: /cannot read.*undefined|cannot read.*null|split|substring/i, message: '文件内容格式异常，无法解析，请检查 TXT 文件是否损坏' },
  { test: /parse.*fail|parse error|invalid format/i, message: '文件解析失败，请确保上传的是标准 TXT 文本文件' },

  // 磁盘/文件系统
  { test: /ENOSPC|no space left/i, message: '服务器磁盘空间不足，请联系管理员' },
  { test: /EACCES|permission denied/i, message: '服务器文件写入权限不足，请联系管理员' },
  { test: /ENOENT|no such file/i, message: '服务器文件系统异常，请稍后重试' },

  // 数据库
  { test: /database|prisma|connection|timeout|SQLITE_BUSY/i, message: '数据库繁忙，请稍后重试' },

  // 网络
  { test: /fetch|network|ECONNREFUSED|ECONNRESET|abort/i, message: '网络连接失败，请检查网络后重试' },
  { test: /Failed to fetch|NetworkError/i, message: '网络连接失败，请检查网络后重试' },

  // JWT/认证
  { test: /unauthorized|forbidden|401|403|jwt/i, message: '登录状态已过期，请重新登录' },

  // 通用服务端
  { test: /internal server error|500/i, message: '服务器开小差了，请稍后重试' },

  // 文件类型
  { test: /mime|file type|extension|\.txt/i, message: '仅支持 .txt 格式的文本文件' },
];

/**
 * 翻译上传相关错误
 * @param rawError 原始错误对象或消息
 * @returns 用户友好的中文提示
 */
export function translateUploadError(rawError: unknown): string {
  const raw = typeof rawError === 'string' ? rawError : rawError instanceof Error ? rawError.message : '';

  for (const rule of uploadRules) {
    if (typeof rule.test === 'string') {
      if (raw.includes(rule.test)) return rule.message;
    } else if (rule.test.test(raw)) {
      return rule.message;
    }
  }

  // 兜底：仅当原文已是中文（后端友好提示）时透传，否则给通用中文，避免英文泄露
  if (raw && hasChinese(raw)) return `上传失败：${raw}`;
  return '上传失败，请稍后重试。如果问题持续存在，请联系管理员。';
}

/**
 * 翻译提取相关错误
 * @param rawError 原始错误对象或消息
 * @returns 用户友好的中文提示
 */
export function translateExtractError(rawError: unknown): string {
  const raw = typeof rawError === 'string' ? rawError : rawError instanceof Error ? rawError.message : '';

  const extractRules: ErrorRule[] = [
    { test: /not found|不存在/i, message: '书籍记录未找到，请刷新页面后重试' },
    { test: /llm|provider|model|timeout/i, message: 'AI 模型服务暂时不可用，请检查 Ollama 是否启动后重试' },
    { test: /rate limit|too many request/i, message: '请求过于频繁，请稍后再试' },
    { test: /network|ECONNREFUSED|timeout|fetch/i, message: '网络连接异常，请检查网络后重试' },
    { test: /database|prisma|SQLITE_BUSY/i, message: '数据库繁忙，请稍后重试' },
  ];

  for (const rule of extractRules) {
    if (typeof rule.test === 'string') {
      if (raw.includes(rule.test)) return rule.message;
    } else if (rule.test.test(raw)) {
      return rule.message;
    }
  }

  return '提取失败，请稍后重试';
}

/** 判断字符串中是否含有中文字符（用于决定是否原样保留后端返回的友好提示）。 */
function hasChinese(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/**
 * 通用 API 错误翻译，供全局 QueryCache 等兜底场景使用。
 * 策略：
 * - 若消息已含中文（后端返回的友好提示，如「尚未提取…」），原样保留，避免重复翻译。
 * - 否则按通用规则匹配常见错误并给出中文。
 * - 都不匹配时给出通用中文，绝不让英文状态码/堆栈直接暴露给用户。
 */
export function translateApiError(rawError: unknown): string {
  const raw = typeof rawError === 'string' ? rawError : rawError instanceof Error ? rawError.message : '';

  if (!raw) return '请求失败，请稍后重试';

  // 后端友好提示（含中文）直接透传
  if (hasChinese(raw)) return raw;

  const generalRules: ErrorRule[] = [
    { test: /401|unauthorized|jwt/i, message: '登录状态已过期，请重新登录' },
    { test: /403|forbidden/i, message: '没有权限执行此操作' },
    { test: /404|not found|不存在/i, message: '请求的资源不存在' },
    { test: /413|payload too large|entity too large/i, message: '请求数据过大' },
    { test: /429|rate limit|too many request/i, message: '请求过于频繁，请稍后再试' },
    { test: /timeout|abort/i, message: '请求超时，请检查网络后重试' },
    { test: /fetch|network|ECONNREFUSED|ECONNRESET/i, message: '网络连接失败，请检查网络后重试' },
    { test: /500|502|503|504|internal server error/i, message: '服务器开小差了，请稍后重试' },
    { test: /database|prisma|SQLITE_BUSY/i, message: '数据库繁忙，请稍后重试' },
    { test: /request failed|export failed/i, message: '请求失败，请稍后重试' },
  ];

  for (const rule of generalRules) {
    if (rule.test instanceof RegExp ? rule.test.test(raw) : raw.includes(rule.test)) {
      return rule.message;
    }
  }

  return '请求失败，请稍后重试';
}
