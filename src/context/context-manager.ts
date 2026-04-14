/**
 * Stateful context manager orchestrating ground truth, compaction, and snapshots.
 * Tracks context window usage in real-time and fires automatic compaction
 * exactly once when the threshold is crossed.
 */

import type { LanguageModel } from 'ai';
import type {
  ContextManagerConfig,
  Observation,
  PinnedFact,
  CompactionResult,
} from './types.js';
import { countTokens } from './token-counter.js';
import { extractGroundTruth, parseExplicitPins, GroundTruthManager } from './ground-truth.js';
import { tieredEviction } from './compactor.js';
import { saveSnapshot } from './snapshot.js';

let _obsCounter = 0;

export class ContextManager {
  private groundTruthManager: GroundTruthManager;
  private observations: Observation[] = [];
  private totalTokens = 0;
  private compactionFired = false;
  private memoryPinned = '';
  private memoryEvictable = '';
  private memoryPinnedTokens = 0;
  private memoryEvictableTokens = 0;

  constructor(
    private readonly config: ContextManagerConfig,
    private readonly sessionDir: string = '/tmp/infrabrain-ctx',
    private readonly sessionId: string = 'default',
  ) {
    this.groundTruthManager = new GroundTruthManager(
      config.groundTruthCap,
      config.windowSize,
    );
  }

  /**
   * Ingest filtered discovery output.
   * Extracts ground truth facts and creates observations per discovery key.
   */
  ingestDiscovery(filteredRaw: Record<string, string>): void {
    // Extract ground truth: containers, ports, IPs, error codes
    const autoFacts = extractGroundTruth(filteredRaw);
    for (const fact of autoFacts) {
      this.groundTruthManager.add(fact);
    }

    // Extract explicit [PIN] markers from all values
    const allText = JSON.stringify(filteredRaw);
    const explicitPins = parseExplicitPins(allText);
    for (const pin of explicitPins) {
      this.groundTruthManager.add(pin);
    }

    // Create an observation per discovery key
    for (const [key, value] of Object.entries(filteredRaw)) {
      const content = `### ${key}\n${value}`;
      const tokens = countTokens(content);
      this.observations.push({
        id: `obs-${++_obsCounter}`,
        content,
        tokens,
        timestamp: Date.now(),
        source: key,
        isNoise: false,
      });
    }

    this.recalculateTokens();
  }

  /**
   * Inject memory context from wake-up layers.
   * Pinned tokens count toward the pinned budget (like ground truth).
   * Evictable tokens are tracked separately (like observations).
   */
  injectMemory(pinned: string, evictable: string): void {
    this.memoryPinned = pinned;
    this.memoryEvictable = evictable;
    this.memoryPinnedTokens = pinned ? countTokens(pinned) : 0;
    this.memoryEvictableTokens = evictable ? countTokens(evictable) : 0;
    this.recalculateTokens();
  }

  /**
   * Get current context window usage.
   */
  getUsage(): { tokens: number; percentage: number; groundTruthTokens: number } {
    return {
      tokens: this.totalTokens,
      percentage: this.totalTokens / this.config.windowSize,
      groundTruthTokens: this.groundTruthManager.getTokens(),
    };
  }

  /**
   * Fire compaction if usage >= threshold.
   * Fires exactly ONCE per threshold crossing (compactionFired guard).
   * Saves a pre-compaction snapshot, then runs tiered eviction targeting config.target.
   */
  async maybeCompact(workerModel?: LanguageModel): Promise<CompactionResult | null> {
    if (this.compactionFired) return null;

    const usage = this.getUsage();
    if (usage.percentage < this.config.threshold) return null;

    this.compactionFired = true;
    const tokensBefore = this.totalTokens;

    // Save pre-compaction snapshot
    const snapshotPath = saveSnapshot({
      sessionDir: this.sessionDir,
      sessionId: this.sessionId,
      groundTruth: this.groundTruthManager.getFacts(),
      observations: this.observations,
      tokenCount: tokensBefore,
      reason: `Compaction triggered at ${(usage.percentage * 100).toFixed(1)}% usage`,
    });

    // Run tiered eviction
    const evictionResult = await tieredEviction({
      observations: this.observations,
      groundTruthTokens: this.groundTruthManager.getTokens(),
      windowSize: this.config.windowSize,
      targetRatio: this.config.target,
      workerModel,
    });

    this.observations = evictionResult.remaining;
    this.recalculateTokens();

    return {
      removedObservations: evictionResult.removed.length,
      tokensBefore,
      tokensAfter: this.totalTokens,
      tiersUsed: evictionResult.summary ? 3 : (evictionResult.removed.some((o) => o.isNoise) ? 1 : 2),
      snapshotPath,
    };
  }

  /**
   * Build the full context string for LLM injection.
   * Format: Ground Truth + [MEMORY] + Observations.
   * The [MEMORY] block sits between Ground Truth and Observations per CONTEXT.md.
   */
  buildContext(): string {
    const gtSection = this.groundTruthManager.buildSection();
    const obsSection = '## Observations\n' +
      this.observations.map((o) => o.content).join('\n\n');

    // Insert memory block between ground truth and observations if available
    const hasMemory = this.memoryPinned || this.memoryEvictable;
    if (hasMemory) {
      const memoryParts: string[] = [];
      if (this.memoryPinned) memoryParts.push(this.memoryPinned);
      if (this.memoryEvictable) memoryParts.push(this.memoryEvictable);
      const memorySection = memoryParts.join('\n\n');

      return `${gtSection}\n\n---\n\n${memorySection}\n\n---\n\n${obsSection}`;
    }

    return `${gtSection}\n\n---\n\n${obsSection}`;
  }

  /**
   * Clear all state for a new session.
   */
  reset(): void {
    this.groundTruthManager = new GroundTruthManager(
      this.config.groundTruthCap,
      this.config.windowSize,
    );
    this.observations = [];
    this.totalTokens = 0;
    this.compactionFired = false;
    this.memoryPinned = '';
    this.memoryEvictable = '';
    this.memoryPinnedTokens = 0;
    this.memoryEvictableTokens = 0;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private recalculateTokens(): void {
    const obsTokens = this.observations.reduce((sum, o) => sum + o.tokens, 0);
    this.totalTokens = this.groundTruthManager.getTokens() + obsTokens
      + this.memoryPinnedTokens + this.memoryEvictableTokens;
  }
}
