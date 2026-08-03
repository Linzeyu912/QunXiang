let pendingShareCode: string | null = null;

/** 只在当前页面进程内传递注册分享码；刷新页面后模块内存会被清空。 */
export function setPendingShareCode(value: string): void {
  pendingShareCode = value;
}

/** 渲染阶段只读，不产生副作用，兼容 React StrictMode 和并发渲染。 */
export function peekPendingShareCode(): string | null {
  return pendingShareCode;
}

/** 组件提交后按已展示值清除，避免误删更新后的分享码。 */
export function clearPendingShareCode(displayedValue: string): void {
  if (pendingShareCode === displayedValue) pendingShareCode = null;
}
