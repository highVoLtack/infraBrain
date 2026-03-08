import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixStep, RunResult, SnapshotRecord } from './types.js';
import { parseCommand } from './runner.js';

/**
 * Map of command prefixes to snapshot command generators.
 * Key: command prefix to match (e.g. "docker stop")
 * Value: function that takes the original command args and returns the snapshot command
 */
export const SNAPSHOT_COMMANDS: Record<string, (args: string[]) => string> = {
  'docker stop': (args) => `docker inspect ${args[args.length - 1]}`,
  'docker rm': (args) => `docker inspect ${args[args.length - 1]}`,
  'docker restart': (args) => `docker inspect ${args[args.length - 1]}`,
  'systemctl stop': (args) => `systemctl show ${args[args.length - 1]}`,
  'systemctl restart': (args) => `systemctl show ${args[args.length - 1]}`,
  'docker network connect': (args) => `docker network inspect ${args[0]}`,
  'docker network disconnect': (args) => `docker network inspect ${args[0]}`,
  'cp': (args) => `cat ${args[0]}`,
  'mv': (args) => `cat ${args[0]}`,
  'tee': (args) => `cat ${args[0]}`,
};

/**
 * Get the snapshot command for a given command string.
 * Matches against known prefixes in SNAPSHOT_COMMANDS.
 * Returns null if no matching prefix found.
 */
export function getSnapshotCommand(command: string): string | null {
  const trimmed = command.trim();

  // Try multi-word prefixes first (e.g. "docker stop"), then single-word
  const sortedPrefixes = Object.keys(SNAPSHOT_COMMANDS).sort((a, b) => b.length - a.length);

  for (const prefix of sortedPrefixes) {
    if (trimmed.startsWith(prefix + ' ')) {
      const rest = trimmed.slice(prefix.length).trim();
      const args = rest.split(/\s+/).filter(Boolean);
      return SNAPSHOT_COMMANDS[prefix](args);
    }
  }

  return null;
}

/**
 * Capture a pre-execution state snapshot before a WRITE or DESTRUCTIVE command.
 * Returns null for READ commands or commands with no known snapshot mapping.
 * Saves snapshot as JSON file in session snapshots/ directory.
 */
export async function captureSnapshot(
  step: FixStep,
  runner: { run: (executable: string, args: string[], options: { timeout: number; maxBuffer?: number }) => Promise<RunResult> },
  sessionDir: string,
  stepIndex: number,
): Promise<SnapshotRecord | null> {
  // No snapshot needed for READ commands
  if (step.risk === 'read') {
    return null;
  }

  // Get the snapshot command for this step
  const snapshotCmd = getSnapshotCommand(step.command);
  if (!snapshotCmd) {
    return null;
  }

  // Parse and run the snapshot command
  const { executable, args } = parseCommand(snapshotCmd);
  const result = await runner.run(executable, args, { timeout: 30000 });

  // Build snapshot record
  const record: SnapshotRecord = {
    stepIndex,
    command: step.command,
    snapshotCommand: snapshotCmd,
    output: result.stdout,
    capturedAt: new Date().toISOString(),
  };

  // Save to session snapshots/ directory
  const snapshotsDir = join(sessionDir, 'snapshots');
  mkdirSync(snapshotsDir, { recursive: true });
  writeFileSync(
    join(snapshotsDir, `step-${stepIndex}.json`),
    JSON.stringify(record, null, 2),
  );

  return record;
}
