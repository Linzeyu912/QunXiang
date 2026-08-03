/**
 * 通用 API 错误翻译，供全局 QueryCache 兜底场景使用。
 *
 * 策略：
 * - 若消息已含中文（后端返回的友好提示），原样保留，避免重复翻译。
 * - 否则按通用规则匹配常见英文错误并给出中文。
 * - 都不匹配时给出通用中文，绝不让英文状态码/堆栈直接暴露给用户。
 *
 * 注意：变更（mutation）的错误由各调用点就地提示，不经过这里。
 * 后端路由已统一返回中文错误消息（见 api/src/lib/send-error.ts），
 * 大部分情况下 hasChinese 分支会直接透传。
 */

interface ErrorRule {
  test: RegExp;
  message: string;
}

/** 判断字符串中是否含有中文字符（用于决定是否原样保留后端返回的友好提示）。 */
function hasChinese(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

const generalRules: ErrorRule[] = [
  // 认证/权限
  { test: /\b401\b|unauthorized|jwt/i, message: '登录状态已过期，请重新登录' },
  { test: /\b403\b|forbidden/i, message: '没有权限执行此操作' },
  // 资源不存在
  { test: /\b404\b|not found/i, message: '请求的资源不存在' },
  // 请求过大
  { test: /\b413\b|payload too large|entity too large/i, message: '请求数据过大' },
  // 频率限制
  { test: /\b429\b|rate limit|too many request/i, message: '请求过于频繁，请稍后再试' },
  // 超时
  { test: /timeout|abort/i, message: '请求超时，请检查网络后重试' },
  // 网络错误
  { test: /failed to fetch|networkerror|ECONNREFUSED|ECONNRESET/i, message: '网络连接失败，请检查网络后重试' },
  // 数据库
  { test: /database|prisma|SQLITE_BUSY/i, message: '数据库繁忙，请稍后重试' },
  // 服务器错误（用词边界避免误匹配含 500/502 的其他文本）
  { test: /internal server error|service unavailable|bad gateway|gateway timeout/i, message: '服务器开小差了，请稍后重试' },
];

export function translateApiError(rawError: unknown): string {
  const raw = typeof rawError === 'string' ? rawError : rawError instanceof Error ? rawError.message : '';

  if (!raw) return '请求失败，请稍后重试';

  // 后端友好提示（含中文）直接透传
  if (hasChinese(raw)) return raw;

  for (const rule of generalRules) {
    if (rule.test.test(raw)) {
      return rule.message;
    }
  }

  return '请求失败，请稍后重试';
}
