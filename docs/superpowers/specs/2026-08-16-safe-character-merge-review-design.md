# Safe Character Merge Review Design

## Goal

Keep the existing LLM-first, whole-book extraction pipeline, while preventing uncertain character aliases and address-form matches from being merged automatically.

## Scope

This is a one-book, one-run review layer. It does not add cross-book memory, embeddings, or a new database schema. Exact normalized canonical-name duplicates remain automatic. Alias containment and Chinese address-form normalization become review candidates.

## Design

1. `entity-resolution` will expose a pure candidate builder that compares persisted character records and returns only uncertain pairs. A candidate includes both character IDs/names, the matching rule, aliases, chapter ranges, and descriptions.
2. The existing resolver will only auto-merge exact normalized names. It will preserve address-form and alias variants as separate records so they can be reviewed safely.
3. New character API endpoints will list pending candidates, merge an accepted pair transactionally, and record a rejection on both characters using the existing `CharacterReview` audit table. Rejected pairs are suppressed from future candidate lists for that run.
4. The entity-review page will show a "疑似重复角色" section. A reviewer can merge into either character or keep both independent. The card exposes the matching reason, aliases, descriptions, and chapter coverage as evidence.

## Safety Rules

- No approximate-name, alias, or title/address-form match may merge without a reviewer action.
- Merge requests must verify both characters belong to the same owned book.
- The accepted merge preserves both names as aliases, unions chapter/relationship/outfit fields, uses the higher confidence, and records the operation in `CharacterReview` before deleting the secondary record.
- A rejection is a pair-specific audit event and blocks that pair from the current review list.

## Verification

- Unit tests cover exact-name automatic merging, uncertain candidate generation, candidate suppression, and lossless merge-field composition.
- API route tests cover ownership and accepted/rejected decisions.
- The affected package and web tests run independently. The full suite is retried; its current baseline is blocked by the running API holding Prisma's Windows engine DLL.
