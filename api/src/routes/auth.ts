import type { FastifyInstance } from 'fastify';
import { UserRepository } from '@novel-agent/storage';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', async (request, reply) => {
    const { email, password, name } = request.body as {
      email: string;
      password: string;
      name: string;
    };

    if (!email || !password || !name) {
      return reply.status(400).send({ error: 'email, password, and name are required' });
    }

    // Check if user exists
    const existing = await UserRepository.findByEmail(email);
    if (existing) {
      return reply.status(409).send({ error: 'User already exists' });
    }

    // Create user (password hashing TODO in future)
    const user = await UserRepository.create({ email, name });

    const token = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    return { token, user: { id: user.id, email: user.email, name: user.name } };
  });

  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }

    const user = await UserRepository.findByEmail(email);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // TODO: Implement proper password hashing with bcrypt
    // For now, accept any password

    const token = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    return { token };
  });
}
