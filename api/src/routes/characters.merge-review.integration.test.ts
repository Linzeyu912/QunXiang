import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../app.js';
import { prisma } from '@novel-agent/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';

const ORIGIN = 'http://localhost:5173';

describe('角色合并人工审核', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  let token: string;
  let bookId: string;
  let primaryId: string;
  let secondaryId: string;

  const headers = (mutation = false) => ({
    authorization: `Bearer ${token}`,
    ...(mutation ? { origin: ORIGIN } : {}),
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'character-merge-review-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_SIGN_SECRET = 'character-merge-review-sign-secret';
    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    const user = await prisma.user.create({ data: testUserInput(`merge-review-${suffix}@test.local`) });
    userId = user.id;
    token = app.jwt.sign({ userId: user.id, email: user.email, name: user.name });
    bookId = (await prisma.book.create({
      data: { title: '合并审核测试', filePath: `D:/tmp/${suffix}.txt`, fileSize: 1, mimeType: 'text/plain', userId },
    })).id;

    primaryId = (await prisma.character.create({
      data: {
        bookId, name: '萧炎', aliases: ['炎儿'], description: '萧家少年', confidence: 0.9,
        chapterAppearances: [1], mentionCount: 3, dialogueCount: 1,
      },
    })).id;
    secondaryId = (await prisma.character.create({
      data: {
        bookId, name: '萧炎哥', aliases: ['三少爷'], description: '被这样称呼的角色', confidence: 0.8,
        chapterRef: '第12章', chapterAppearances: [12], mentionCount: 2, dialogueCount: 1,
      },
    })).id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.book.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (app) await app.close();
  });

  it('拒绝后同时从候选与直接合并接口阻止该角色对', async () => {
    const reject = await app.inject({
      method: 'POST', url: `/characters/merge-candidates/${primaryId}/reject`, headers: headers(true), payload: { secondaryId },
    });
    expect(reject.statusCode).toBe(200);

    const candidates = await app.inject({ method: 'GET', url: `/characters/merge-candidates?bookId=${bookId}`, headers: headers() });
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().candidates).toEqual([]);

    const accept = await app.inject({
      method: 'POST', url: `/characters/merge-candidates/${primaryId}/accept`, headers: headers(true), payload: { secondaryId },
    });
    expect(accept.statusCode).toBe(409);
    expect(await prisma.character.count({ where: { id: { in: [primaryId, secondaryId] } } })).toBe(2);
  });

  it('接受后保留次角色元数据，并留下可追溯的合并审核记录', async () => {
    const primary = await prisma.character.create({
      data: {
        bookId, name: '药老', aliases: ['老师'], description: '戒指中的神秘老人', confidence: 0.91,
        chapterAppearances: [1], mentionCount: 3, dialogueCount: 1, status: 'PENDING',
      },
    });
    const secondary = await prisma.character.create({
      data: {
        bookId, name: '药老哥', aliases: ['药尊者'], description: '炼药术高深', confidence: 0.82,
        chapterRef: '第12章', firstChapter: 12, lastChapter: 12, chapterAppearances: [12], mentionCount: 2, dialogueCount: 1,
        status: 'APPROVED', coCharacters: ['萧炎', '药老'],
      },
    });
    await prisma.character.update({ where: { id: primary.id }, data: { coCharacters: ['药老哥'] } });
    const secondaryReview = await prisma.characterReview.create({
      data: { characterId: secondary.id, userId, action: 'EDITED', previousValue: '旧描述', newValue: '新描述' },
    });

    const accept = await app.inject({
      method: 'POST', url: `/characters/merge-candidates/${primary.id}/accept`, headers: headers(true), payload: { secondaryId: secondary.id },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().character).toMatchObject({
      id: primary.id,
      aliases: ['老师', '药尊者', '药老哥'],
      chapterRef: '第12章',
      firstChapter: 1,
      lastChapter: 12,
      chapterAppearances: [1, 12],
      mentionCount: 5,
      dialogueCount: 2,
      coCharacters: ['萧炎'],
      status: 'PENDING',
    });
    expect(await prisma.character.findUnique({ where: { id: secondary.id } })).toBeNull();
    await expect(prisma.characterReview.findUnique({ where: { id: secondaryReview.id } })).resolves.toMatchObject({ characterId: primary.id });
    await expect(prisma.characterReview.findFirst({
      where: { characterId: primary.id, action: 'MERGE_ACCEPTED', previousValue: secondary.id },
    })).resolves.toMatchObject({ newValue: JSON.stringify({ primaryId: primary.id, secondaryId: secondary.id }) });
  });
});
