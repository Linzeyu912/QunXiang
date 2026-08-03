/** 账号查询与唯一约束统一使用的邮箱规范化规则。 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
