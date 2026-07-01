import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyJwt from '@fastify/jwt';
import { initializeDatabase } from '@novel-agent/storage';
import { getDefaultProvider } from '@novel-agent/llm';
import { booksRoutes } from './routes/books.js';
import { charactersRoutes } from './routes/characters.js';
import { locationRoutes } from './routes/locations.js';
import { itemRoutes } from './routes/items.js';
import { extractRoutes } from './routes/extract.js';
import { exportRoutes } from './routes/export.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';

const fastify = Fastify({
  logger: true,
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
  // Initialize database
  await initializeDatabase();

  // Validate LLM provider is available (fail fast if not configured)
  try {
    const provider = await getDefaultProvider();
    console.log(`LLM Provider: ${provider.name}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('LLM provider not available:', msg);
    console.error('');
    console.error('To fix, set one of:');
    console.error('  1. Run "ollama serve" (for local Ollama)');
    console.error('  2. Set LLM_MOCK_ENABLED=true (for mock data only)');
    console.error('  3. Set LLM_PROVIDER=custom with your own API key');
    process.exit(1);
  }

  // Register plugins
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

  await fastify.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : process.env.NODE_ENV !== 'production',
  });
  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  // Register JWT plugin
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  await fastify.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { expiresIn: '15m' },
  });

  // Register auth hook - verify JWT on all non-auth routes
  fastify.addHook('onRequest', async (request, _reply) => {
    // Skip auth for health check and auth routes
    if (request.url === '/health' || request.url.startsWith('/health/llm') || request.url.startsWith('/auth')) {
      return;
    }

    try {
      await request.jwtVerify();
    } catch {
      // Set anonymous user for unauthenticated requests
      request.user = {
        userId: 'anonymous',
        email: 'anonymous@example.com',
        name: 'Anonymous',
      };
    }
  });

  // Register routes
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(booksRoutes, { prefix: '/books' });
  await fastify.register(charactersRoutes, { prefix: '/characters' });
  await fastify.register(locationRoutes, { prefix: '/locations' });
  await fastify.register(itemRoutes, { prefix: '/items' });
  await fastify.register(extractRoutes, { prefix: '/books' });
  await fastify.register(exportRoutes, { prefix: '/export' });
  await fastify.register(healthRoutes, { prefix: '/health' });

  // Health check (overridden by healthRoutes)
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Start server
  const address = await fastify.listen({ port: 3000 });
  console.log(`Server listening at ${address}`);
}

start().catch(console.error);