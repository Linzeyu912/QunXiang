import io

# characters.ts PATCH：乐观锁
p='api/src/routes/characters.ts'
s = io.open(p, encoding='utf-8').read()
old = """      const body = characterUpdateSchema.parse(request.body);

      const ownerId = await resolveOwnerId(request);
      const character = ownerId ? await CharacterRepository.findOwnedById(id, ownerId) : null;
      if (!character) {
        return sendBookNotFound(reply);
      }"""
new = """      const body = characterUpdateSchema.parse(request.body);
      const { expectedVersion } = (request.body ?? {}) as { expectedVersion?: number };

      const ownerId = await resolveOwnerId(request);
      const character = ownerId ? await CharacterRepository.findOwnedById(id, ownerId) : null;
      if (!character) {
        return sendBookNotFound(reply);
      }
      // 乐观锁（实施包 E2）：调用方版本与当前不一致时拒绝，要求刷新后重试
      if (typeof expectedVersion === 'number' && (character.version ?? 1) !== expectedVersion) {
        return reply.status(409).send({ error: '该实体已被其他操作修改，请刷新后重试' });
      }"""
assert old in s, 'characters patch'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('characters ok')

specs = [
    ('api/src/routes/locations.ts', 'locationUpdateSchema', 'LocationRepository', 'location'),
    ('api/src/routes/items.ts', 'itemUpdateSchema', 'ItemRepository', 'item'),
    ('api/src/routes/worldview.ts', 'worldviewUpdateSchema', 'WorldviewRepository', 'worldview'),
]
for fname, schema, repo, var in specs:
    s = io.open(fname, encoding='utf-8').read()
    old = ('      const body = %s.parse(request.body);\n\n'
           '      const ownerId = await resolveOwnerId(request);\n'
           '      const %s = ownerId ? await %s.findOwnedById(id, ownerId) : null;\n'
           '      if (!%s) {\n'
           '        return sendBookNotFound(reply);\n'
           '      }') % (schema, var, repo, var)
    new = ('      const rawBody = (request.body ?? {}) as Record<string, unknown>;\n'
           '      const body = %s.parse(rawBody);\n'
           '      const expectedVersion = typeof rawBody.expectedVersion === \'number\' ? rawBody.expectedVersion : undefined;\n\n'
           '      const ownerId = await resolveOwnerId(request);\n'
           '      const %s = ownerId ? await %s.findOwnedById(id, ownerId) : null;\n'
           '      if (!%s) {\n'
           '        return sendBookNotFound(reply);\n'
           '      }\n'
           '      // 乐观锁（实施包 E2）：版本冲突返回 409\n'
           '      if (expectedVersion !== undefined && (%s.version ?? 1) !== expectedVersion) {\n'
           '        return reply.status(409).send({ error: \'该实体已被其他操作修改，请刷新后重试\' });\n'
           '      }') % (schema, var, repo, var, var)
    assert old in s, fname
    s = s.replace(old, new, 1)
    io.open(fname, 'w', encoding='utf-8', newline='\n').write(s)
    print(fname, 'ok')

# 注册 entity-reviews 路由
p = 'api/src/app.ts'
s = io.open(p, encoding='utf-8').read()
if 'entityReviewRoutes' not in s:
    s = s.replace("import { extractionRunRoutes } from './routes/extraction-runs.js';",
                  "import { extractionRunRoutes } from './routes/extraction-runs.js';\nimport { entityReviewRoutes } from './routes/entity-reviews.js';")
    s = s.replace("  await fastify.register(extractionRunRoutes, { prefix: '/books' });",
                  "  await fastify.register(extractionRunRoutes, { prefix: '/books' });\n  await fastify.register(entityReviewRoutes, { prefix: '/books' });")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('app ok')
