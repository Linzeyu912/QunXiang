# 项目状态快照 (2026-05-28)

## 最近完成的功能

### 1. 文件存储方案 B（磁盘存储 + 数据库索引）
- 上传文件写入 `storage/uploads/{uuid}.txt`
- 数据库只存 `filePath/fileSize/mimeType`
- 临时文件 + 原子重命名保证一致性
- 删除时级联 unlink 磁盘文件

### 2. 历史记录页面 (HistoryPage)
- 顶部导航栏：上传 / 历史记录
- 表格：书名、大小、状态、日期、操作
- 搜索书名 + 状态筛选
- 查看原文 Modal（5000字截断）
- 删除确认 + 级联删除

### 3. 前端中文汉化
- 所有界面文字改为简体中文

### 4. 错误提示 + 状态标签
- 上传/提取失败时红色提示条
- 状态颜色标签（蓝/黄/绿/红）
- 文件大小预校验（50MB）

## 当前架构

```
前端: React + Tailwind + Vite (port 5173)
后端: Fastify + Prisma + SQLite (port 3000)
调度: InMemoryTaskQueue + 4阶段Pipeline
LLM: Custom API Provider
```

## 已知问题
- 提取角色可能返回0个（LLM未配置或文本过短）
- 前端类型提示仍有一些linter误报（不影响运行）

## 关键文件改动
- api/src/routes/books.ts — 上传/列表/查看原文/删除
- web/src/App.tsx — 3页路由
- web/src/pages/HistoryPage.tsx — 新增
- web/src/pages/BookListPage.tsx — 精简
- storage/prisma/schema.prisma — Book表结构
- storage/src/book.repository.ts — 级联删除
- scheduler/src/agents/extractor.agent.ts — 磁盘读取

## 待验证
- 实际上传流程（浏览器手动测试）
- 提取角色是否正常工作
- 删除时磁盘文件是否同步清理
