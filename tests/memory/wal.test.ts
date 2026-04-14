import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryWAL, getMemoryWAL, clearWALCache } from '../../src/memory/wal.js';
import type { WALEntry, WALMutationType } from '../../src/memory/types.js';

function makeEntry(overrides: Partial<WALEntry> = {}): WALEntry {
  return {
    type: 'incident_add' as WALMutationType,
    timestamp: new Date().toISOString(),
    sessionId: 'sess-test-001',
    details: { incidentId: 'inc-001', summary: 'nginx crashed' },
    ...overrides,
  };
}

describe('MemoryWAL', () => {
  let tempDir: string;

  beforeEach(async () => {
    clearWALCache();
    tempDir = await mkdtemp(join(tmpdir(), 'wal-test-'));
  });

  afterEach(async () => {
    clearWALCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('appends a mutation entry and reads it back as valid JSON', () => {
    const wal = getMemoryWAL(tempDir);
    const entry = makeEntry();
    const ok = wal.append(entry);
    expect(ok).toBe(true);

    const entries = wal.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('incident_add');
    expect(entries[0].sessionId).toBe('sess-test-001');
    expect(entries[0].details).toEqual({ incidentId: 'inc-001', summary: 'nginx crashed' });
  });

  it('entries contain required fields (type, timestamp, sessionId, details)', () => {
    const wal = getMemoryWAL(tempDir);
    const entry = makeEntry({
      type: 'entity_add',
      timestamp: '2026-04-10T12:00:00Z',
      sessionId: 'sess-test-002',
      details: { entityId: 'ent-001' },
    });
    wal.append(entry);

    const entries = wal.read();
    expect(entries).toHaveLength(1);
    const read = entries[0];
    expect(read).toHaveProperty('type', 'entity_add');
    expect(read).toHaveProperty('timestamp', '2026-04-10T12:00:00Z');
    expect(read).toHaveProperty('sessionId', 'sess-test-002');
    expect(read).toHaveProperty('details');
    expect(read.details).toEqual({ entityId: 'ent-001' });
  });

  it('rotates file when size exceeds 10MB threshold', async () => {
    const wal = getMemoryWAL(tempDir);

    // Pre-fill the WAL file to just under 10MB by writing directly
    const walPath = join(tempDir, 'memory.wal.jsonl');
    const bigLine = JSON.stringify(makeEntry({ details: { data: 'x'.repeat(1000) } })) + '\n';
    const linesNeeded = Math.ceil((10 * 1024 * 1024) / bigLine.length);
    const bigContent = bigLine.repeat(linesNeeded);
    await writeFile(walPath, bigContent);

    // Now append one more entry which should trigger rotation
    const ok = wal.append(makeEntry({ type: 'incident_update' }));
    expect(ok).toBe(true);

    // The rotated file should exist
    const rotatedPath = join(tempDir, 'memory.wal.1.jsonl');
    const rotatedStat = await stat(rotatedPath);
    expect(rotatedStat.size).toBeGreaterThan(0);

    // The current WAL should have only the new entry
    const entries = wal.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('incident_update');
  });

  it('gracefully handles write failure (returns false, does not throw)', () => {
    // Use an invalid directory path that cannot be created
    const wal = getMemoryWAL('/dev/null/impossible/path');
    const entry = makeEntry();
    const ok = wal.append(entry);
    expect(ok).toBe(false);
  });

  it('singleton returns same instance for same directory', () => {
    const wal1 = getMemoryWAL(tempDir);
    const wal2 = getMemoryWAL(tempDir);
    expect(wal1).toBe(wal2);
  });

  it('different directories return different instances', () => {
    const wal1 = getMemoryWAL(join(tempDir, 'a'));
    const wal2 = getMemoryWAL(join(tempDir, 'b'));
    expect(wal1).not.toBe(wal2);
  });

  it('read returns empty array when no WAL file exists', () => {
    const wal = getMemoryWAL(tempDir);
    const entries = wal.read();
    expect(entries).toEqual([]);
  });

  it('appends multiple entries and reads all back in order', () => {
    const wal = getMemoryWAL(tempDir);
    const entry1 = makeEntry({ type: 'incident_add', sessionId: 'sess-1' });
    const entry2 = makeEntry({ type: 'entity_add', sessionId: 'sess-2' });
    const entry3 = makeEntry({ type: 'entity_update', sessionId: 'sess-3' });

    wal.append(entry1);
    wal.append(entry2);
    wal.append(entry3);

    const entries = wal.read();
    expect(entries).toHaveLength(3);
    expect(entries[0].sessionId).toBe('sess-1');
    expect(entries[1].sessionId).toBe('sess-2');
    expect(entries[2].sessionId).toBe('sess-3');
  });

  it('read gracefully handles corrupted JSONL lines', async () => {
    const wal = getMemoryWAL(tempDir);
    const walPath = join(tempDir, 'memory.wal.jsonl');

    // Write a mix of valid and invalid lines
    const validEntry = JSON.stringify(makeEntry());
    const content = `${validEntry}\nNOT_VALID_JSON\n${validEntry}\n`;
    await writeFile(walPath, content);

    // Should skip the invalid line and return the valid ones
    const entries = wal.read();
    expect(entries).toHaveLength(2);
  });
});
