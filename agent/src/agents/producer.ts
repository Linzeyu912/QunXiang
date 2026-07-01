/**
 * 制片人 Producer Agent — 主 agent（同步入口）.
 *
 * 驱动 scheduler 的 4-agent 富管道：extractor → validator → entity-resolution → reviewer。
 * 每次调用 run() 都会：构造 TaskDispatcher（内存队列）→ 入队 extractor → 同步 processNext 跑完整条链。
 *
 * 分工：
 * - scheduler 的 TaskDispatcher 负责真正执行：重试、DB 持久化（characters/locations/items）、
 *   writePipelineFinalSummary、Book 状态收尾、进度事件（eventBus）。
 * - Producer 负责作为主入口 + 阶段可见性（日志 + 阶段报告）。
 *
 * 这样既保留了"主 agent 调用其他 agent"的单一入口语义，又复用了 scheduler 的全部富能力
 * （prescan、三类实体、story-arcs、importance 评分、DB 入库）。
 */
import { TaskDispatcher, InMemoryTaskQueue, eventBus } from '@novel-agent/scheduler';
import type { PipelineEvent } from '@novel-agent/scheduler';
import type { AgentType } from '../types.js';
import { EXTRACTION_PIPELINE } from '../pipeline.js';

const STAGE_NAMES: Record<AgentType, string> = {
  extractor: '角色提取',
  validator: '置信度校验',
  'entity-resolution': '实体消解',
  reviewer: '审核入库',
};

export interface ProducerStageReport {
  agent: AgentType;
  name: string;
  success: boolean;
  error?: string;
  durationMs: number;
  progress?: number;
}

export interface ProducerRunResult {
  success: boolean;
  bookId: string;
  stages: ProducerStageReport[];
  totalDurationMs: number;
  message?: string;
}

export class ProducerAgent {
  /**
   * 主入口：跑完整条 4-agent 管道。
   * 每次都新建 dispatcher 与队列，依次调用 4 个子 agent。
   */
  async run(bookId: string, userId?: string): Promise<ProducerRunResult> {
    console.log('\n════════════════════════════════════════════════');
    console.log(`🎬 制片人 Producer 启动 — bookId: ${bookId}`);
    console.log(`   管道(scheduler): ${EXTRACTION_PIPELINE.join(' → ')}`);
    console.log('════════════════════════════════════════════════');

    const stages: ProducerStageReport[] = [];
    const startTimes = new Map<AgentType, number>();
    let terminal: { success: boolean; message?: string } | null = null;

    const onEvent = (event: PipelineEvent) => {
      if (event.type === 'stage_start' && event.stageId) {
        const agent = event.stageId as AgentType;
        startTimes.set(agent, Date.now());
        console.log(`\n🎬 [制片人] 调用子 agent → ${agent}（${event.stageName || STAGE_NAMES[agent]}）`);
      } else if (event.type === 'stage_complete' && event.stageId) {
        const agent = event.stageId as AgentType;
        const ms = Date.now() - (startTimes.get(agent) ?? Date.now());
        stages.push({
          agent,
          name: event.stageName || STAGE_NAMES[agent],
          success: true,
          durationMs: ms,
          progress: event.progress,
        });
        console.log(`   ✅ ${agent} 完成 (${ms}ms) progress=${event.progress}%`);
      } else if (event.type === 'completed') {
        terminal = { success: true };
        console.log(`\n🎬 [制片人] 管道全部完成`);
      } else if (event.type === 'error') {
        const agent = event.stageId as AgentType | undefined;
        if (agent && !stages.find((s) => s.agent === agent)) {
          const ms = Date.now() - (startTimes.get(agent) ?? Date.now());
          stages.push({ agent, name: STAGE_NAMES[agent], success: false, durationMs: ms, error: event.message });
        }
        terminal = { success: false, message: event.message };
        console.log(`   ❌ ${agent || '管道'} 失败 — ${event.message}`);
      }
    };

    eventBus.on(bookId, onEvent);

    const dispatcher = new TaskDispatcher(new InMemoryTaskQueue());
    const t0 = Date.now();
    try {
      await dispatcher.startExtraction(bookId, userId || 'producer');
      // processNext 递归同步跑完整条链（extractor → validator → entity-resolution → reviewer）
      await dispatcher.processNext('extractor');
    } catch (error) {
      terminal = { success: false, message: error instanceof Error ? error.message : String(error) };
      console.log(`\n💥 制片人异常: ${terminal.message}`);
    }
    const totalMs = Date.now() - t0;
    eventBus.off(bookId, onEvent);

    console.log('\n════════════════════════════════════════════════');
    console.log(`🎬 制片人完成 — success=${terminal?.success ?? false}  总耗时 ${totalMs}ms`);
    console.log('════════════════════════════════════════════════');

    return {
      success: terminal?.success ?? false,
      bookId,
      stages,
      totalDurationMs: totalMs,
      message: terminal?.message,
    };
  }
}

export function createProducer(): ProducerAgent {
  return new ProducerAgent();
}
