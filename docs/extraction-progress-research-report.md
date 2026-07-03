# 提取进度可视化调研报告与实施方案

## 一、调研范围与参考项目

### 1.1 参考项目

| 项目 | 类型 | 进度展示方式 | 关键技术 |
|------|------|-------------|----------|
| **GitHub Actions** | CI/CD | 左侧步骤列表 + 右侧实时日志折叠面板 | Polling + WebSocket |
| **n8n** | Workflow Automation | 节点 DAG 图 + 节点状态色 + 执行轨迹高亮 | WebSocket |
| **Apache Airflow** | Data Pipeline | DAG 拓扑图 + 任务状态色块 + 运行历史甘特图 | Polling |
| **Dagster** | Data Orchestrator | Asset 目录 + Run 详情步骤列表 + 事件时间线 | GraphQL Subscriptions |
| **Unstructured Platform** | Document Parsing | DAG 画布节点高亮 + 右侧面板状态 | REST Polling |
| **Vercel Deployments** | Deployment | 步骤指示器 + 进度条 + 实时日志流 | SSE |

### 1.2 实时通信技术对比

| 技术 | 方向 | 复杂度 | 适用场景 | 推荐度 |
|------|------|--------|----------|--------|
| **Polling** | 客户端→服务器 | 低 | 简单低频状态查询 | ⭐⭐ |
| **Long Polling** | 客户端→服务器 | 中 | 减少请求数但仍需客户端发起 | ⭐⭐⭐ |
| **SSE** | 服务器→客户端 | 低 | 单向实时推送（进度/日志） | ⭐⭐⭐⭐⭐ |
| **WebSocket** | 双向 | 高 | 双向交互（聊天、协作） | ⭐⭐⭐ |

**结论**：对于 pipeline 进度展示，**SSE 是最佳默认选择**——它是基于 HTTP 的单向推送，浏览器原生支持（`EventSource` API），自动重连，不需要额外库，比 WebSocket 轻量，比轮询实时。

---

## 二、UI 设计模式提炼

### 2.1 核心模式：Step Indicator（步骤指示器）

这是 CI/CD 和数据 pipeline 领域最通用的模式：

```
┌─────────────────────────────────────────┐
│  ●───●───○───○                           │  ← 节点连线式
│  提取  校验  消解  审核                   │
│  ✓    ✓    ⏳   ·                        │
├─────────────────────────────────────────┤
│  [=================>    ] 75%            │  ← 进度条
│  预计剩余 12 秒                          │
├─────────────────────────────────────────┤
│  ▼ 校验阶段日志                          │  ← 可折叠日志
│    [14:32:01] 检测到 47 个候选角色       │
│    [14:32:03] 置信度评估完成             │
│    [14:32:05] 通过规则校验               │
└─────────────────────────────────────────┘
```

### 2.2 状态视觉规范

| 状态 | 颜色 | 图标 | 说明 |
|------|------|------|------|
| `pending` | 灰色 `#94A3B8` | 空心圆 | 等待执行 |
| `running` | 蓝色 `#2563EB` | 转圈动画 | 正在执行 |
| `completed` | 绿色 `#10B981` | 对勾 | 成功完成 |
| `failed` | 红色 `#EF4444` | 叉号 | 执行失败 |
| `skipped` | 紫色 `#8B5CF6` | 斜杠 | 被跳过 |

### 2.3 信息层级

1. **L1 - 概览**：整体进度百分比 + 当前阶段名称
2. **L2 - 阶段**：每个阶段的名称/状态/耗时
3. **L3 - 详情**：当前阶段的日志/输出（可折叠）
4. **L4 - 元数据**：开始时间、预计完成时间、触发者

---

## 三、novel-agent 提取进度方案

### 3.1 技术架构

```
前端 (React)
  ├── ExtractionProgress 组件 (StageIndicator + ProgressBar)
  ├── useExtractionStream Hook (EventSource 封装)
  └── 集成到 UploadPage + LibraryPage

后端 (Fastify)
  ├── GET /api/books/:id/extract/stream  (SSE endpoint)
  ├── TaskDispatcher 增强 (阶段追踪 + 事件发射)
  └── 存储层扩展 (Task 表增加 stage 字段)
```

### 3.2 数据模型

```typescript
// 阶段定义（前后端共享）
interface ExtractionStage {
  id: string;              // 如 "extractor"
  name: string;            // 如 "角色提取"
  description: string;     // 如 "调用 LLM 从章节中提取候选角色"
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  order: number;           // 1, 2, 3, 4
  startedAt?: string;      // ISO 8601
  completedAt?: string;    // ISO 8601
  durationMs?: number;     // 耗时毫秒
  progress?: number;       // 0-100 (该阶段内部进度，可选)
  message?: string;        // 当前状态描述
  logs?: string[];         // 阶段日志（可选）
}

// SSE 推送事件结构
interface ExtractionEvent {
  type: 'stage_change' | 'log' | 'complete' | 'error' | 'heartbeat';
  timestamp: string;
  payload: {
    bookId: string;
    overallProgress: number;   // 0-100
    currentStage?: ExtractionStage;
    stages?: ExtractionStage[];
    message?: string;
    error?: string;
  };
}
```

### 3.3 API 设计

#### SSE 端点（推荐主方案）

```
GET /api/books/:id/extract/stream
Content-Type: text/event-stream

事件流示例：

event: connected
data: {"bookId":"abc","overallProgress":0,"stages":[...]}

event: stage_change
data: {"bookId":"abc","overallProgress":25,"currentStage":{"id":"extractor","status":"running","message":"正在处理第 3/12 章..."}}

event: log
data: {"bookId":"abc","stageId":"extractor","message":"第 5 章提取到 12 个角色"}

event: stage_change
data: {"bookId":"abc","overallProgress":50,"currentStage":{"id":"validator","status":"running"}}

event: complete
data: {"bookId":"abc","overallProgress":100,"charactersCount":47}

event: error
data: {"bookId":"abc","error":"LLM 服务连接超时","stageId":"extractor"}
```

#### 轮询端点（降级方案）

```
GET /api/books/:id/extract/status?taskId=xxx
→ 返回当前 { stages, overallProgress, currentStage }
```

### 3.4 阶段映射（4 阶段 → 进度）

| 阶段 | ID | 权重 | 触发条件 | 典型耗时 |
|------|-----|------|----------|----------|
| 角色提取 | `extractor` | 40% | LLM 处理各章节 | 最长（取决于章节数） |
| 置信度校验 | `validator` | 20% | 提取完成后 | 短（本地计算） |
| 实体消解 | `entity-resolution` | 25% | 校验完成后 | 中等 |
| 审核入库 | `reviewer` | 15% | 消解完成后 | 短 |

**进度计算公式**：
```
overallProgress = Σ(已完成阶段权重) + 当前阶段权重 × 当前阶段内部进度
```

### 3.5 前端组件设计

```tsx
// StageIndicator.tsx - 步骤指示器
<StageIndicator
  stages={[
    { id: 'extractor', name: '角色提取', status: 'completed', durationMs: 45000 },
    { id: 'validator', name: '置信度校验', status: 'running', message: '评估中...' },
    { id: 'entity-resolution', name: '实体消解', status: 'pending' },
    { id: 'reviewer', name: '审核入库', status: 'pending' },
  ]}
  currentStageId="validator"
/>

// ExtractionProgress.tsx - 完整进度面板
<ExtractionProgress
  bookId="abc"
  overallProgress={45}
  estimatedTimeRemaining={120}  // 秒
  stages={stages}
  logs={logs}
  onComplete={() => loadBooks()}
  onError={(err) => showError(err)}
/>

// useExtractionStream.ts - SSE Hook
function useExtractionStream(bookId: string) {
  const [stages, setStages] = useState<ExtractionStage[]>(initialStages);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  
  useEffect(() => {
    const es = new EventSource(`/api/books/${bookId}/extract/stream`);
    es.addEventListener('stage_change', (e) => {
      const data = JSON.parse(e.data);
      setStages(data.stages);
      setProgress(data.overallProgress);
    });
    es.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      setLogs(prev => [...prev, data.message]);
    });
    es.addEventListener('complete', () => {
      es.close();
      onComplete?.();
    });
    es.addEventListener('error', (e) => {
      const data = JSON.parse(e.data);
      onError?.(data.error);
      es.close();
    });
    return () => es.close();
  }, [bookId]);
  
  return { stages, progress, logs, isRunning };
}
```

### 3.6 后端实现要点

```typescript
// api/src/routes/extract.ts - 新增 SSE endpoint
fastify.get('/:id/extract/stream', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  
  const bookId = (request.params as { id: string }).id;
  
  // 订阅调度器事件
  const unsubscribe = dispatcher.subscribe(bookId, (event) => {
    reply.raw.write(`event: ${event.type}\n`);
    reply.raw.write(`data: ${JSON.stringify(event.payload)}\n\n`);
  });
  
  // 客户端断开时清理
  request.raw.on('close', () => {
    unsubscribe();
  });
});
```

### 3.7 降级策略

```
首选：SSE 实时推送
  ↓ 浏览器不支持 / 连接失败
降级：Long Polling (3秒间隔)
  ↓ 仍不可用
降级：标准 Polling (5秒间隔)
  ↓ 完全不可用
降级：静态状态 + 手动刷新按钮
```

---

## 四、实施路线图

### Phase 1：后端基础（2-3小时）
1. 扩展 `Task` 表增加 `stage` 字段
2. `TaskDispatcher` 增加阶段事件发射
3. 新增 SSE endpoint `/books/:id/extract/stream`
4. 保持现有轮询 endpoint 兼容

### Phase 2：前端组件（3-4小时）
1. `useExtractionStream` Hook（SSE 封装 + 降级）
2. `StageIndicator` 步骤指示器组件
3. `ExtractionProgress` 完整进度面板
4. 集成到 UploadPage 和 LibraryPage

### Phase 3：增强体验（2-3小时）
1. 阶段内部进度（如 extractor 的 "3/12 章"）
2. 可折叠日志面板
3. 预计完成时间
4. 动画过渡效果

---

## 五、关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 实时通信 | **SSE** | 单向推送足够，HTTP 基础，自动重连，无需额外库 |
| 进度计算 | **加权阶段** | 各阶段耗时差异大，平均分配不合理 |
| 日志展示 | **可折叠面板** | 不占用主空间，需要时展开 |
| 错误处理 | **阶段级重试 + 整体失败** | extractor 失败可重试，3次后整体失败 |
| 存储策略 | **内存 + DB 混合** | 运行中在内存，完成后持久化到 Task 表 |

---

## 六、参考截图描述

**GitHub Actions Run 界面**：
- 左侧垂直步骤列表，每个步骤有状态图标
- 点击步骤展开右侧实时日志
- 整体有进度感但无明确百分比

**n8n Execution 界面**：
- DAG 图节点高亮显示执行轨迹
- 节点颜色表示状态（绿/红/蓝）
- 侧边栏显示执行详情和时间

**Vercel Deployment 界面**：
- 水平步骤条 + 大进度百分比
- 当前步骤有旋转动画
- 下方折叠日志区域

**推荐 novel-agent 采用**：Vercel 风格的水平步骤条 + GitHub Actions 风格的日志折叠面板。
