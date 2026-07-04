/** HTTP 409 语义：资源状态冲突（如重复触发正在进行的提取）。 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
