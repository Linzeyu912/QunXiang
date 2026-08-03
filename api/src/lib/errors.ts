/** HTTP 409 语义：资源状态冲突（如重复触发正在进行的提取）。 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** HTTP 404 语义：资源不存在或不属于当前用户。 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
