import { v7 as uuidv7 } from 'uuid';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionState } from './types.js';

export function createSession(baseDir: string): SessionState {
  const sessionId = uuidv7();
  const now = new Date().toISOString();

  const sessionDir = join(baseDir, '.infrabrain', 'sessions', sessionId);

  // Create session directory structure
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(join(sessionDir, 'diffs'), { recursive: true });

  const state: SessionState = {
    sessionId,
    createdAt: now,
    updatedAt: now,
    status: 'active',
  };

  // Write initial state.json
  writeFileSync(join(sessionDir, 'state.json'), JSON.stringify(state, null, 2));

  // Create empty audit.jsonl
  writeFileSync(join(sessionDir, 'audit.jsonl'), '');

  return state;
}

export function loadSession(sessionDir: string): SessionState {
  const content = readFileSync(join(sessionDir, 'state.json'), 'utf-8');
  return JSON.parse(content) as SessionState;
}
