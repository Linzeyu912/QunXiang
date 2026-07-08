import 'dotenv/config';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { initializeDatabase } from '@novel-agent/storage';
import { getDefaultProvider, loadPersistedConfig } from '@novel-agent/llm';
import { booksRoutes } from './routes/books.js';
import { charactersRoutes } from './routes/characters.js';
import { locationRoutes } from './routes/locations.js';
import { itemRoutes } from './routes/items.js';
import { extractRoutes } from './routes/extract.js';
import { exportRoutes } from './routes/export.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { ensureDefaultUser } from './lib/defaultUser.js';
import { storiesRoutes } from './routes/stories.js';
import { directorRoutes } from './routes/director.js';
import { artifactsRoutes } from './routes/artifacts.js';

const fastify = Fastify({
  // SSE 端点为支持 EventSource 会把 JWT 放进 ?access_token= query（见 extractToken），
  // 默认 logger 会把完整 req.url 记进日志/控制台，导致长期有效的 JWT 落盘。
  // 用 redact 脱敏 url 与 authorization 头，避免 token 泄露到日志。
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: ['req.url', 'req.headers.authorization', 'req.headers.cookie'],
      censor: '[REDACTED]',
    },
  },
});

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

async function start() {
  // Load persisted runtime LLM config before checking provider status.
  // The API should still start when no provider is configured so the web
  // settings page can be used on a fresh deployment.
  try {
    loadPersistedConfig();
  } catch (err) {
    console.warn('Failed to load persisted LLM config:', err instanceof Error ? err.message : String(err));
  }

  // Initialize database
  await initializeDatabase();

  // 确保默认本地用户存在，前端开机即可静默自动登录（见前端 App.tsx）。
  // 失败仅告警不阻塞启动，便于默认账号机制出问题时仍能手动登录。
  try {
    await ensureDefaultUser();
  } catch (err) {
    console.warn('Failed to ensure default user:', err instanceof Error ? err.message : String(err));
  }

  // Report LLM provider status without blocking server startup.
  try {
    const provider = await getDefaultProvider();
    const configured = await provider.isConfigured();
    console.log(`LLM Provider: ${provider.name}${configured ? '' : ' (not ready)'}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn('LLM provider not available yet:', msg);
    console.warn('Configure it in the web UI at /settings/llm, or set LLM_PROVIDER in api/.env.');
  }

  // Register plugins
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

  await fastify.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : process.env.NODE_ENV !== 'production',
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });
  // 限流：默认 global=false，只对显式声明 config.rateLimit 的路由生效（见 /auth/login、/auth/register）。
  await fastify.register(rateLimit, { global: false });

  // Register JWT plugin
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  await fastify.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { expiresIn: '7d' },
  });

  // 从 Authorization 头或（SSE 场景）URL query 里取 token。
  // EventSource 无法设置自定义请求头，因此 SSE 端点允许 ?access_token= 兜底。
  function extractToken(request: FastifyRequest): string | null {
    const auth = request.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    const qIdx = request.url.indexOf('?');
    if (qIdx >= 0) {
      const token = new URLSearchParams(request.url.slice(qIdx + 1)).get('access_token');
      if (token) return token;
    }
    return null;
  }

  // 全局鉴权：仅 /auth/login、/auth/register、存活检查 /health 放行；
  // /auth/me、/auth/refresh 仍需有效 token（由本钩子填充 request.user）。
  fastify.addHook('onRequest', async (request, reply) => {
    const pathNoQuery = request.url.split('?')[0];
    if (
      pathNoQuery === '/health' ||
      pathNoQuery === '/auth/login' ||
      pathNoQuery === '/auth/register'
    ) {
      return;
    }
    const token = extractToken(request);
    if (!token) {
      return reply.status(401).send({ error: '未登录' });
    }
    try {
      request.user = fastify.jwt.verify(token);
    } catch {
      return reply.status(401).send({ error: '登录已过期' });
    }
  });

  // Register routes
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(booksRoutes, { prefix: '/books' });
  await fastify.register(charactersRoutes, { prefix: '/characters' });
  await fastify.register(locationRoutes, { prefix: '/locations' });
  await fastify.register(itemRoutes, { prefix: '/items' });
  await fastify.register(extractRoutes, { prefix: '/books' });
  await fastify.register(storiesRoutes, { prefix: '/books' });
  await fastify.register(directorRoutes, { prefix: '/books' });
  await fastify.register(artifactsRoutes, { prefix: '/books' });
  await fastify.register(exportRoutes, { prefix: '/export' });
  await fastify.register(healthRoutes, { prefix: '/health' });

  // Health check (overridden by healthRoutes)
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Start server
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST;
  const address = await fastify.listen({ port, host });
  console.log(`Server listening at ${address}`);
}

start().catch(console.error);
