import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { initializeDatabase } from '@qunxiang/storage';
import { getDefaultProvider, loadPersistedConfig } from '@qunxiang/llm';
import { ACCESS_TOKEN_EXPIRES_IN, getAllowedOrigins } from './config/auth.js';
import { assertTrustedMutation, RequestSecurityError } from './lib/request-security.js';
import { findUserCached } from './lib/user-cache.js';
import { booksRoutes } from './routes/books.js';
import { charactersRoutes } from './routes/characters.js';
import { locationRoutes } from './routes/locations.js';
import { itemRoutes } from './routes/items.js';
import { worldviewRoutes } from './routes/worldview.js';
import { extractRoutes } from './routes/extract.js';
import { extractionRunRoutes } from './routes/extraction-runs.js';
import { entityReviewRoutes } from './routes/entity-reviews.js';
import { exportRoutes } from './routes/export.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes } from './routes/account.js';
import { healthRoutes } from './routes/health.js';
import { storiesRoutes } from './routes/stories.js';
import { directorRoutes } from './routes/director.js';
import { artifactsRoutes } from './routes/artifacts.js';
import { imageRoutes } from './routes/images.js';
import { visualSpecRoutes } from './routes/visual-specs.js';
import { snapshotRoutes } from './routes/snapshots.js';
import { objectDownloadRoutes } from './routes/object-download.js';
import { sharesRoutes } from './routes/shares.js';
import { publicAssetRoutes } from './routes/public-assets.js';
import { startSnapshotWorker } from './services/job-worker.service.js';
import { AUTH_REQUIRED_BODY } from './lib/api-errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      userId: string;
      email: string;
      name: string;
    };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; email: string; name: string };
    user: { userId: string; email: string; name: string };
  }
}

export interface BuildAppOptions {
  logger?: boolean;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_ROUTES = new Set([
  '/health',
  '/auth/login',
  '/auth/register',
  '/auth/session/refresh',
  '/objects/dl',
]);

/** 构建并初始化 Fastify 应用，但不监听端口。 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: options.logger ?? true });

  try {
    loadPersistedConfig();
  } catch (error) {
    console.warn('加载持久化模型配置失败：', error instanceof Error ? error.message : String(error));
  }

  await initializeDatabase();

  try {
    const provider = await getDefaultProvider();
    const configured = await provider.isConfigured();
    console.log(`模型服务：${provider.name}${configured ? '' : '（尚未就绪）'}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('模型服务暂不可用：', message);
    console.warn('请在网页的模型设置页完成配置，或在 api/.env 中设置 LLM_PROVIDER。');
  }

  const allowedOrigins = getAllowedOrigins();
  await fastify.register(cors, {
    origin: [...allowedOrigins],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
  });
  await fastify.register(cookie);
  await fastify.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });
  await fastify.register(rateLimit, { global: false });

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('未配置 JWT_SECRET，服务无法启动');
  }
  await fastify.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
  });

  function extractToken(request: FastifyRequest): string | null {
    const auth = request.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return null;
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const pathWithoutQuery = request.url.split('?')[0];

    if (MUTATION_METHODS.has(request.method)) {
      try {
        assertTrustedMutation(request, allowedOrigins);
      } catch (error) {
        if (error instanceof RequestSecurityError) {
          return reply.status(403).send({ error: error.message });
        }
        throw error;
      }
    }

    if (request.method === 'OPTIONS' || PUBLIC_ROUTES.has(pathWithoutQuery)) {
      return;
    }

    const token = extractToken(request);
    if (!token) {
      return reply.status(401).send(AUTH_REQUIRED_BODY);
    }

    let payload: { userId: string; email: string; name: string };
    try {
      payload = fastify.jwt.verify(token);
    } catch {
      return reply.status(401).send({ error: '登录已过期' });
    }

    const user = await findUserCached(payload.userId);
    if (!user) {
      return reply.status(401).send({ error: '登录状态已失效，请重新登录' });
    }
    if (user.status === 'DISABLED') {
      return reply.status(403).send({ error: '账号已停用，请联系管理员' });
    }
    request.user = { userId: user.id, email: user.email, name: user.name };
  });

  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(accountRoutes, { prefix: '/account' });
  await fastify.register(booksRoutes, { prefix: '/books' });
  await fastify.register(charactersRoutes, { prefix: '/characters' });
  await fastify.register(locationRoutes, { prefix: '/locations' });
  await fastify.register(itemRoutes, { prefix: '/items' });
  await fastify.register(worldviewRoutes, { prefix: '/worldview' });
  await fastify.register(extractRoutes, { prefix: '/books' });
  await fastify.register(extractionRunRoutes, { prefix: '/books' });
  await fastify.register(entityReviewRoutes, { prefix: '/books' });
  await fastify.register(storiesRoutes, { prefix: '/books' });
  await fastify.register(directorRoutes, { prefix: '/books' });
  await fastify.register(artifactsRoutes, { prefix: '/books' });
  await fastify.register(imageRoutes, { prefix: '/books' });
  await fastify.register(visualSpecRoutes, { prefix: '/books' });
  await fastify.register(snapshotRoutes, { prefix: '/books' });
  await fastify.register(exportRoutes, { prefix: '/export' });
  await fastify.register(healthRoutes, { prefix: '/health' });
  await fastify.register(objectDownloadRoutes);
  await fastify.register(sharesRoutes);
  await fastify.register(publicAssetRoutes, { prefix: '/public-assets' });
  fastify.get('/health', async () => ({ status: 'ok' }));

  // 启动快照后台 worker（asset-snapshot + snapshot-archive）。
  // FsObjectStore 需要签名密钥才能下发短时下载令牌；缺失时整体启动中止。
  if (!process.env.OBJECT_STORAGE_SIGN_SECRET) {
    throw new Error('未配置对象存储签名密钥（OBJECT_STORAGE_SIGN_SECRET），服务无法启动');
  }
  // 每个应用实例使用唯一 workerId：租约按该字符串判定归属，固定 ID 在
  // 多实例/测试同进程多 buildApp 时会互相 complete/fail 对方刚抢到的任务。
  const snapshotWorker = startSnapshotWorker(1000, { workerId: `snapshot-worker-${randomUUID()}` });
  // 应用关闭时停止 worker 的轮询与回收定时器，避免定时器与数据库轮询泄漏
  fastify.addHook('onClose', async () => {
    snapshotWorker.stop();
  });

  return fastify;
}
