import type { QueryClient } from '@tanstack/react-query';

let queryClient: QueryClient | null = null;
let cacheOwnerId: string | null | undefined;
let transitionQueue: Promise<void> = Promise.resolve();

/** 注册应用唯一的查询客户端；测试可传 null 解除注册。 */
export function registerAccountQueryClient(client: QueryClient | null): void {
  queryClient = client;
  cacheOwnerId = undefined;
  transitionQueue = Promise.resolve();
}

/**
 * 在认证主体变化前取消全部在途查询并清空缓存。
 * 转换串行执行，避免快速退出/换号时旧响应在清理后重新写入。
 */
export function transitionAccountQueryOwner(ownerId: string | null): Promise<void> {
  const transition = async () => {
    if (cacheOwnerId === ownerId) return;
    if (queryClient) {
      await queryClient.cancelQueries();
      queryClient.getQueryCache().clear();
    }
    cacheOwnerId = ownerId;
  };

  transitionQueue = transitionQueue.then(transition, transition);
  return transitionQueue;
}
