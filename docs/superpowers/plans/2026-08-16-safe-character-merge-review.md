# Safe Character Merge Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require human approval for ambiguous character merges while retaining exact-name automatic deduplication.

**Architecture:** The extraction resolver retains only exact canonical-name merging. A pure candidate builder identifies alias and address-form pairs after characters are persisted. The API exposes candidates and transactional merge/reject actions; the existing entity-review UI renders those actions.

**Tech Stack:** TypeScript, Vitest, Fastify, Prisma/PostgreSQL, React, TanStack Query.

## Global Constraints

- Keep LLM extraction and regex prescan behavior unchanged.
- Never auto-merge by alias or Chinese title/address normalization.
- Enforce same-book ownership for all review actions.
- Reuse `CharacterReview` for durable, pair-specific audit decisions; no Prisma migration is required.
- User-facing text must be Chinese.

---

### Task 1: Separate safe deduplication from review candidates

**Files:**
- Modify: `entity-resolution/src/resolver.ts`
- Create: `entity-resolution/src/review-candidates.ts`
- Modify: `entity-resolution/src/index.ts`
- Modify: `entity-resolution/src/resolver.test.ts`
- Create: `entity-resolution/src/review-candidates.test.ts`

**Interfaces:**
- Produces `buildCharacterMergeCandidates(characters)` returning `{ primaryId, secondaryId, reasons, primary, secondary }[]`.
- Produces `mergeCharacterRecords(primary, secondary)` for the storage transaction.

- [ ] Write failing tests proving `萧炎` and `萧炎哥` are not auto-merged but generate one candidate, while duplicate `萧炎` names still merge.
- [ ] Implement candidate generation using only safe alias containment and `isSameChineseName`.
- [ ] Change `resolve()` to merge only equal normalized canonical names.
- [ ] Run `pnpm exec vitest run entity-resolution/src/resolver.test.ts entity-resolution/src/review-candidates.test.ts`.

### Task 2: Add owned API review workflow

**Files:**
- Modify: `storage/src/character.repository.ts`
- Modify: `storage/src/review.repository.ts`
- Modify: `api/src/routes/characters.ts`
- Create: `api/src/routes/characters.merge-review.test.ts`

**Interfaces:**
- `GET /characters/merge-candidates?bookId=` returns non-rejected candidates.
- `POST /characters/merge-candidates/:primaryId/accept` accepts `{ secondaryId }`.
- `POST /characters/merge-candidates/:primaryId/reject` accepts `{ secondaryId }`.

- [ ] Write failing route tests for cross-book denial, candidate retrieval, accepted lossless merge, and rejection suppression.
- [ ] Add repository methods that retrieve owned characters, compose a merge in one transaction, and delete only the owned secondary record.
- [ ] Record `MERGE_ACCEPTED` or `MERGE_REJECTED` for both characters with the peer ID in audit data.
- [ ] Run the route test file with its database setup.

### Task 3: Surface candidates in the existing review screen

**Files:**
- Modify: `web/src/api/entities.ts`
- Create: `web/src/components/review/CharacterMergeCandidates.tsx`
- Modify: `web/src/pages/EntityReviewPage.tsx`
- Create: `web/src/components/review/CharacterMergeCandidates.test.tsx`

**Interfaces:**
- `useCharacterMergeCandidates(bookId)`, `useAcceptCharacterMerge(bookId)`, and `useRejectCharacterMerge(bookId)`.
- `CharacterMergeCandidates` receives `bookId` and presents pair evidence and actions.

- [ ] Write a failing component test for rule/chapter evidence rendering and both action callbacks.
- [ ] Implement query/mutations and invalidate character/candidate caches on success.
- [ ] Render the review section above the character list with Chinese merge and independent actions.
- [ ] Run the component test and the existing entity review tests.

### Task 4: Verify the integrated behavior

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-safe-character-merge-review-design.md`

- [ ] Run entity-resolution and web tests, then retry `pnpm test`.
- [ ] Record whether the Prisma DLL lock still prevents the full suite and keep that environmental failure distinct from assertion failures.
- [ ] Inspect the working diff to confirm no unrelated files, including `.hermes/`, were changed.
