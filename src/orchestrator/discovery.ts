import PQueue from 'p-queue';
import { needsShell, runShellCommand, parseCommand, runCommand } from '../execution/runner.js';
import { encodeForLLM } from '../llm/toon-encoder.js';
import type { DiscoveryCommand, DiscoveryResult } from './types.js';

/**
 * Extract the container name targeted by a docker command.
 * Returns '__host__' for host-level commands (docker ps, docker stats, docker network, etc.)
 * or non-docker commands.
 */
export function extractCommandTarget(command: string): string {
  const trimmed = command.trim();

  // docker exec [-it flags] <container> ...
  const execMatch = trimmed.match(/^docker\s+exec\s+(?:-\w+\s+)*(\S+)/);
  if (execMatch) return execMatch[1];

  // docker logs <container> ...
  const logsMatch = trimmed.match(/^docker\s+logs\s+(\S+)/);
  if (logsMatch) return logsMatch[1];

  // docker inspect <container> ...
  const inspectMatch = trimmed.match(/^docker\s+inspect\s+(\S+)/);
  if (inspectMatch) return inspectMatch[1];

  // All other docker commands (ps, stats, network, etc.) are host-level
  return '__host__';
}

/**
 * Per-container queues for mutex serialization.
 * Each container gets a PQueue with concurrency: 1 so commands targeting
 * the same container never overlap.
 */
const containerQueues = new Map<string, PQueue>();

/**
 * Get or create a per-container queue with concurrency 1.
 * Exported for test access (clearing queues between tests).
 *
 * Special key '__clear__' resets all queues (test-only).
 */
export function getContainerQueue(container: string): PQueue {
  if (container === '__clear__') {
    containerQueues.clear();
    return new PQueue({ concurrency: 1 });
  }

  let queue = containerQueues.get(container);
  if (!queue) {
    queue = new PQueue({ concurrency: 1 });
    containerQueues.set(container, queue);
  }
  return queue;
}

/**
 * Run discovery commands in parallel with per-container mutex.
 *
 * Commands targeting different containers run concurrently.
 * Commands targeting the same container are serialized via PQueue (concurrency: 1).
 * Uses Promise.allSettled for fault isolation -- one failure does not abort others.
 *
 * Result format is identical to the sequential discovery in debug.ts:
 * TOON-encoded context string + raw label->output map.
 */
export async function runParallelDiscovery(
  commands: DiscoveryCommand[],
): Promise<DiscoveryResult> {
  if (commands.length === 0) {
    return { context: '', raw: {} };
  }

  // Launch all commands through per-container queues
  const promises = commands.map((cmd, index) => {
    const target = extractCommandTarget(cmd.command);
    const queue = getContainerQueue(target);

    return queue.add(async () => {
      let result;
      if (needsShell(cmd.command)) {
        result = await runShellCommand(cmd.command, { timeout: 15_000 });
      } else {
        const { executable, args } = parseCommand(cmd.command);
        result = await runCommand(executable, args, { timeout: 10_000 });
      }
      const output = result.stdout.trim() || result.stderr.trim() || '(empty)';
      return { index, label: cmd.label, output };
    });
  });

  const settled = await Promise.allSettled(promises);

  // Collect fulfilled results into a map indexed by original position
  const resultMap = new Map<number, { label: string; output: string }>();
  for (const entry of settled) {
    if (entry.status === 'fulfilled' && entry.value) {
      resultMap.set(entry.value.index, entry.value);
    }
  }

  // Build raw object preserving original command order
  const raw: Record<string, string> = {};
  for (let i = 0; i < commands.length; i++) {
    const item = resultMap.get(i);
    if (item) {
      raw[item.label] = item.output;
    }
  }

  const context = encodeForLLM(raw, 'Discovery (ground truth from live system)');

  return { context, raw };
}
