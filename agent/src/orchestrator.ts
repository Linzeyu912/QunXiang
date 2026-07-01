import type { AgentType, AgentPayload, AgentResult, OrchestratorConfig } from './types.js';
import { DEFAULT_ORCHESTRATOR_CONFIG } from './types.js';
import { getNextAgent, isLastAgent } from './pipeline.js';
import type { AgentExecutor } from './agents/index.js';

export interface OrchestratorOptions {
  config?: Partial<OrchestratorConfig>;
  onAgentComplete?: (agentType: AgentType, result: AgentResult) => void;
  onAgentError?: (agentType: AgentType, error: string) => void;
  onPipelineComplete?: (finalResult: AgentResult) => void;
}

export class Orchestrator {
  private agents: Map<AgentType, AgentExecutor>;
  private config: OrchestratorConfig;

  constructor(
    private executors: Map<AgentType, AgentExecutor>,
    options: OrchestratorOptions = {}
  ) {
    this.agents = executors;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...options.config };
  }

  async executePipeline(initialPayload: AgentPayload): Promise<AgentResult> {
    let currentAgent: AgentType = 'extractor';
    let currentPayload = { ...initialPayload };
    const previousResults: AgentResult[] = [];

    while (currentAgent) {
      const executor = this.agents.get(currentAgent);
      if (!executor) {
        return {
          success: false,
          error: `No executor found for agent: ${currentAgent}`,
        };
      }

      const result = await this.executeWithRetry(currentAgent, currentPayload);

      if (!result.success) {
        return result;
      }

      previousResults.push(result);

      if (isLastAgent(currentAgent)) {
        return result;
      }

      const nextAgent = getNextAgent(currentAgent);
      if (!nextAgent) {
        return result;
      }

      currentPayload = this.buildNextPayload(currentAgent, nextAgent, result, currentPayload);
      currentAgent = nextAgent;
    }

    return {
      success: false,
      error: 'Pipeline execution ended unexpectedly',
    };
  }

  private async executeWithRetry(
    agentType: AgentType,
    payload: AgentPayload,
    attempt = 1
  ): Promise<AgentResult> {
    const executor = this.agents.get(agentType);

    if (!executor) {
      return {
        success: false,
        error: `No executor found for agent: ${agentType}`,
      };
    }

    try {
      const result = await executor(payload);

      if (!result.success) {
        if (attempt < this.config.maxRetries) {
          const delay = Math.min(
            this.config.baseDelayMs * Math.pow(2, attempt - 1),
            this.config.maxDelayMs
          );
          await this.sleep(delay);
          return this.executeWithRetry(agentType, payload, attempt + 1);
        }
      }

      return result;
    } catch (error) {
      if (attempt < this.config.maxRetries) {
        const delay = Math.min(
          this.config.baseDelayMs * Math.pow(2, attempt - 1),
          this.config.maxDelayMs
        );
        await this.sleep(delay);
        return this.executeWithRetry(agentType, payload, attempt + 1);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildNextPayload(
    currentAgent: AgentType,
    nextAgent: AgentType,
    currentResult: AgentResult,
    currentPayload: AgentPayload
  ): AgentPayload {
    const nextPayload: AgentPayload = {
      ...currentPayload,
      bookId: currentPayload.bookId,
    };

    if (currentResult.data) {
      Object.assign(nextPayload, { previousResult: currentResult.data });
    }

    return nextPayload;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
