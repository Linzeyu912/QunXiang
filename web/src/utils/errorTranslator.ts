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

  // 兜底：如果错误很短直接展示，否则显示通用提示
  if (raw && raw.length < 40) return `上传失败：${raw}`;
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
