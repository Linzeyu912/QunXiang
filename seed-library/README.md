# seed-library — 公共书库（预置书籍）

本目录存放随仓库分发的预置书籍包。**新用户注册时**，API 会自动把本目录下每本书
完整物化到其个人书架（原文 + 已审核实体 + 提示词/视觉设定 + 已生成图片），
之后用户可自由修改/删除，互不影响。

## 如何添加一本书

1. 在系统里把书跑完：提取管道 → 审核实体 → 生成图片。
2. 导出书包（在 `api/` 目录下）：

   ```bash
   pnpm --filter @novel-agent/api seed:export <bookId> <slug>
   ```

   `slug` 为小写字母/数字/连字符，将成为本目录下的子目录名。
3. 检查导出结果（实体计数、图片数、产物 12/12），然后 `git add seed-library/`。

## 包结构（由导出工具生成，请勿手改）

```
<slug>/
  manifest.json            元信息 + 计数（物化时校验，不符则拒绝）
  source.txt               原文（UTF-8）
  entities.json            三类实体（剥掉 id/bookId/status，物化统一 APPROVED）
  run-summary.json         运行摘要（物化时改写 bookId）
  artifacts/entities/      描述/视觉设定/提示词等提取产物
  images/index.json + 图片  实体图片
```

实现：`api/src/services/library-seed.service.ts`（物化）、
`api/scripts/export-seed-book.ts`（导出）、注册钩子 `api/src/routes/auth.ts`。
