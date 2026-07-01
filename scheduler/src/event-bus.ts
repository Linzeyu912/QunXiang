import { EventEmitter } from 'events';

export type PipelineEventType = 'stage_start' | 'stage_complete' | 'completed' | 'error';

export interface PipelineEvent {
  type: PipelineEventType;
  bookId: string;
  stageId?: string;
  stageName?: string;
  progress?: number;
  message?: string;
  timestamp: number;
}

type EventListener = (event: PipelineEvent) => void;

/**
 * Global singleton event bus for extraction pipeline events.
 * Each bookId has its own listener set; events are emitted per-bookId.
 */
class ExtractionEventBus {
  private emitter = new EventEmitter();
  // Track active listeners count for cleanup
  private listenerCounts = new Map<string, number>();

  emit(event: PipelineEvent): void {
    this.emitter.emit(`pipeline:${event.bookId}`, event);
  }

  on(bookId: string, cb: EventListener): void {
    this.emitter.on(`pipeline:${bookId}`, cb);
    this.listenerCounts.set(
      bookId,
      (this.listenerCounts.get(bookId) ?? 0) + 1
    );
  }

  off(bookId: string, cb: EventListener): void {
    this.emitter.off(`pipeline:${bookId}`, cb);
    const count = (this.listenerCounts.get(bookId) ?? 1) - 1;
    if (count <= 0) {
      this.listenerCounts.delete(bookId);
      // Clean up dangling listeners to prevent memory leaks
      this.emitter.removeAllListeners(`pipeline:${bookId}`);
    } else {
      this.listenerCounts.set(bookId, count);
    }
  }

  /** Remove all listeners for a bookId */
  removeAllListeners(bookId: string): void {
    this.emitter.removeAllListeners(`pipeline:${bookId}`);
    this.listenerCounts.delete(bookId);
  }

  /** Get number of active listeners for a bookId */
  getListenerCount(bookId: string): number {
    return this.listenerCounts.get(bookId) ?? 0;
  }
}

// Global singleton
export const eventBus = new ExtractionEventBus();
