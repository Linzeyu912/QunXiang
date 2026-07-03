# Novel-Agent Pipeline Flowchart

## 端到端流程总览

```mermaid
flowchart TD
    A["📄 TXT 小说文件"] --> B["run_producer.mjs / API Server"]
    B --> C["ProducerAgent.run(bookId)"]
    C --> D["TaskDispatcher.startExtraction()"]
    D --> E["Stage 1: Extractor Agent"]

    E --> E1["BookRepository.findById() → 读取文件"]
    E1 --> E2["parseTxtEnhanced()"]
    E2 --> E2a["preprocess() 文本归一化+噪声过滤"]
    E2a --> E2b["splitChaptersStructured() 章节切分"]
    E2b --> E2c["analyzeChapters() 章节重要性分析"]
    E2c --> E2d["prescanEntities() 实体预扫描 ⬇️"]

    E2d --> E3["createExtractor() LLM批量提取 30章/批"]
    E3 --> E4["fuseCharactersWithPrescan() LLM主体+预扫描补充"]
    E4 --> E5["幻觉过滤: 0提及+0对话 → 丢弃"]
    E5 --> E6["llmEntitiesWithPrescan() 位置/物品增强"]
    E6 --> E7["extractStoryAssets() 故事资产提取"]

    E7 --> F["Dispatcher: 持久化到数据库"]
    F --> G["Stage 2: Validator Agent"]

    G --> G1["validateCharacters() 低置信/缺字段/别名冲突"]
    G1 --> G2["validateEntityBatch() 位置+物品 去重+阈值0.4"]
    G2 --> H["Stage 3: Entity Resolution Agent"]

    H --> H1["resolve() 同名合并/别名匹配/中文称谓归一化"]
    H1 --> H2["选择规范名 + 清洗别名"]
    H2 --> I["Dispatcher: 再次持久化到数据库"]

    I --> J["Stage 4: Reviewer Agent"]
    J --> J1["标记: 等待人工审核"]
    J1 --> K["writePipelineFinalSummary()"]
    K --> K1["output/run-summary.json"]
    K1 --> K2["entities/characters.json, items.json, locations.json, events.json"]
    K2 --> L["BookRepository.updateStatus('EXTRACTED')"]
    L --> M["eventBus.emit('completed')"]

    style A fill:#4CAF50,color:#fff
    style E fill:#2196F3,color:#fff
    style G fill:#FF9800,color:#fff
    style H fill:#9C27B0,color:#fff
    style J fill:#607D8B,color:#fff
    style M fill:#4CAF50,color:#fff
```

---

## Entity Pre-Scan 模块内部流程

```mermaid
flowchart TD
    A["章节文本输入"] --> B["Step 1: 正则扫描 ×4"]
    B --> B1["scanCharacterEntities() 人物"]
    B --> B2["scanLocationEntities() 地点"]
    B --> B3["scanItemEntities() 物品"]
    B --> B4["scanEventEntities() 事件"]

    B1 --> C["Step 2: 全文角色发现"]
    C --> C1["discoverFullTextCharacterMentions()"]
    C1 --> C2["合并可信别名映射 (许宁宴→许七安)"]
    C2 --> C3["产出: 提及信号(count, 章节覆盖)"]

    C3 --> D["Step 3: LLM补全 (可选)"]
    D --> E["Step 4: 别名规范化"]
    E --> E1["canonicalizeCharacterMentions()"]

    E1 --> F["Step 5: 置信度过滤"]
    F --> F1["maxConfidence >= 0.6 AND totalCount >= 1"]

    F1 --> G["Step 6: 评分参数 + 置信度计算"]
    G --> G1["位置特征: 首次/末次/平均位置"]
    G1 --> G2["分布广度: 章节覆盖/连续跨度/均匀性"]
    G2 --> G3["语义段落: 上下文多样性/段落密度"]
    G3 --> G4["加权混合置信度 + 惩罚项"]

    G4 --> H["Step 7: 重要性分析"]
    H --> H1["因果必要性 (行为驱动+不可替代)"]
    H --> H2["信息独特性 (bigram语义相似度)"]
    H --> H3["状态转换 (情绪波动+关系变化)"]
    H --> H4["制作价值 (写作完整度+改编可用性)"]
    H1 --> H5["importance = 0.7×故事值 + 0.3×制作值"]
    H2 --> H5
    H3 --> H5
    H4 --> H5

    H5 --> I["Step 8: 分层路由"]
    I --> I1["core: importance>=0.7 & confidence>=0.3 → main"]
    I --> I2["supporting: importance>=0.5 & confidence>=0.2 → main"]
    I --> I3["candidate: importance>=0.3 → staging"]
    I --> I4["archived: 其余 → archive"]

    I1 --> J["Step 09: 输出选择 + 文件写入"]
    I2 --> J
    I3 --> J
    I4 -.-> J

    J --> J1["selectOutputEntities() 过滤归档层+无效名"]
    J1 --> J2["writeEntityFiles() character/location/item.txt"]

    style A fill:#4CAF50,color:#fff
    style B fill:#2196F3,color:#fff
    style C fill:#FF9800,color:#fff
    style G fill:#9C27B0,color:#fff
    style H fill:#E91E63,color:#fff
    style I fill:#607D8B,color:#fff
    style J fill:#4CAF50,color:#fff
```

---

## 入口对比

```mermaid
flowchart LR
    subgraph "入口 A: CLI Producer"
        A1["run_producer.mjs"] --> A2["ProducerAgent"]
        A2 --> A3["完整4-Agent管道 + DB"]
    end

    subgraph "入口 B: Prescan Only"
        B1["run-prescan.ts"] --> B2["prescanEntities()"]
        B2 --> B3["无DB, 仅正则+LLM"]
    end

    subgraph "入口 C: API Server"
        C1["Fastify POST /books/:id/extract"] --> C2["TaskDispatcher + DBQueue"]
        C2 --> C3["SSE Stream 实时进度"]
    end

    subgraph "入口 D: Test Script"
        D1["test_full_pipeline.mjs"] --> D2["Import管道验证"]
        D2 --> D3["无Scheduler, 仅预扫描"]
    end

    style A1 fill:#2196F3,color:#fff
    style B1 fill:#FF9800,color:#fff
    style C1 fill:#9C27B0,color:#fff
    style D1 fill:#607D8B,color:#fff
```

---

## 模块架构图

```mermaid
flowchart TB
    subgraph "核心模块"
        CORE["core types"]
        LLM["llm 提供商抽象"]
        PROMPTS["prompts 提示词模板"]
        SCHEMAS["schemas Zod校验"]
    end

    subgraph "数据处理管道"
        IMPORT["import TXT解析"]
        PREPROCESS["preprocess 归一化"]
        CHAP["chapter-analysis 章节分析"]
        PRESCAN["entity-prescan 预扫描"]
        STORY["story-arcs 故事弧线"]
    end

    subgraph "Agent 管道"
        EXTRACT["extractors LLM提取"]
        VALID["validators 校验"]
        RESOL["entity-resolution 消歧"]
        SCHED["scheduler 任务调度"]
        AGENT["agent ProducerAgent"]
    end

    subgraph "存储 & API"
        STORAGE["storage Prisma ORM"]
        API["api Fastify服务"]
        WEB["web React前端"]
        EXPORT["exporters 导出"]
    end

    IMPORT --> PREPROCESS --> CHAP --> PRESCAN
    PRESCAN -.-> EXTRACT
    EXTRACT --> VALID --> RESOL
    RESOL --> SCHED --> AGENT
    AGENT --> STORAGE
    API --> SCHED
    STORAGE --> EXPORT
    WEB --> API

    LLM --> EXTRACT
    LLM -.-> PRESCAN
    PROMPTS --> EXTRACT
    PROMPTS --> RESOL
    SCHEMAS --> VALID
    CORE --> STORAGE

    style PRESCAN fill:#E91E63,color:#fff
    style SCHED fill:#2196F3,color:#fff
    style AGENT fill:#4CAF50,color:#fff
    style STORAGE fill:#FF9800,color:#fff
```

---

## 配置参数速查

| 参数 | 值 | 位置 |
|---|---|---|
| LLM 批次大小 | 30 章/批 | scheduler/dispatcher.ts |
| 最大并发批次 | 3 | scheduler/dispatcher.ts |
| 最大重试 | 3次, 指数退避 | scheduler/dispatcher.ts |
| 预扫描置信度阈值 | 0.6 | entity-prescan |
| 验证器实体阈值 | 0.4 | validators |
| 故事权重 / 制作权重 | 0.7 / 0.3 | entity-prescan/importance |
| core 层 | importance≥0.7, confidence≥0.3 | entity-prescan/scoring |
| supporting 层 | importance≥0.5, confidence≥0.2 | entity-prescan/scoring |
| candidate 层 | importance≥0.3 | entity-prescan/scoring |
| archived 层 | 其余 | entity-prescan/scoring |
