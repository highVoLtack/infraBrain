import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashSkillFiles, runStartupInvalidation } from '../../src/cache/invalidation.js';

describe('hashSkillFiles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skill-hash-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns Map of filename to SHA-256 hash', async () => {
    await writeFile(join(tempDir, 'nginx.md'), '# Nginx skill\ntriggers: nginx');
    await writeFile(join(tempDir, 'postgres.md'), '# Postgres skill\ntriggers: postgres');

    const hashes = hashSkillFiles(tempDir);

    expect(hashes.size).toBe(2);
    expect(hashes.has('nginx.md')).toBe(true);
    expect(hashes.has('postgres.md')).toBe(true);
    // SHA-256 hashes are 64-char hex strings
    expect(hashes.get('nginx.md')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different content', async () => {
    await writeFile(join(tempDir, 'a.md'), 'content A');
    await writeFile(join(tempDir, 'b.md'), 'content B');

    const hashes = hashSkillFiles(tempDir);

    expect(hashes.get('a.md')).not.toBe(hashes.get('b.md'));
  });

  it('returns empty map for empty directory', async () => {
    const hashes = hashSkillFiles(tempDir);
    expect(hashes.size).toBe(0);
  });
});

describe('runStartupInvalidation', () => {
  let tempDir: string;
  let skillsDir: string;
  let hashesPath: string;

  function makeMockStore() {
    return {
      init: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue('id'),
      deleteBySkill: vi.fn().mockResolvedValue(true),
      deleteAll: vi.fn().mockResolvedValue(true),
      listAll: vi.fn().mockResolvedValue([]),
      updateStats: vi.fn().mockResolvedValue(true),
    };
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'invalidation-test-'));
    skillsDir = join(tempDir, 'skills');
    await mkdir(skillsDir);
    hashesPath = join(tempDir, 'skill-hashes.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('first run creates hash file with no purges', async () => {
    await writeFile(join(skillsDir, 'nginx.md'), '# Nginx skill');
    const store = makeMockStore();

    await runStartupInvalidation(store as any, skillsDir, hashesPath);

    // Should not purge anything on first run (no stored hashes to compare)
    expect(store.deleteBySkill).not.toHaveBeenCalled();

    // Hash file should now exist
    const { readFile } = await import('node:fs/promises');
    const storedHashes = JSON.parse(await readFile(hashesPath, 'utf-8'));
    expect(storedHashes).toHaveProperty('nginx.md');
  });

  it('modified skill file triggers deleteBySkill for that skill only', async () => {
    await writeFile(join(skillsDir, 'nginx.md'), '# Nginx v1');
    await writeFile(join(skillsDir, 'postgres.md'), '# Postgres v1');

    const store = makeMockStore();

    // First run: establish baseline hashes
    await runStartupInvalidation(store as any, skillsDir, hashesPath);
    expect(store.deleteBySkill).not.toHaveBeenCalled();

    // Modify nginx skill
    await writeFile(join(skillsDir, 'nginx.md'), '# Nginx v2 - updated');

    // Second run: should detect change
    await runStartupInvalidation(store as any, skillsDir, hashesPath);

    expect(store.deleteBySkill).toHaveBeenCalledWith('nginx');
    expect(store.deleteBySkill).not.toHaveBeenCalledWith('postgres');
  });

  it('unchanged skills are not purged', async () => {
    await writeFile(join(skillsDir, 'nginx.md'), '# Nginx skill');
    const store = makeMockStore();

    // Two runs with no changes
    await runStartupInvalidation(store as any, skillsDir, hashesPath);
    await runStartupInvalidation(store as any, skillsDir, hashesPath);

    expect(store.deleteBySkill).not.toHaveBeenCalled();
  });

  it('new skill file does not cause purge', async () => {
    await writeFile(join(skillsDir, 'nginx.md'), '# Nginx skill');
    const store = makeMockStore();

    await runStartupInvalidation(store as any, skillsDir, hashesPath);

    // Add a new skill
    await writeFile(join(skillsDir, 'docker.md'), '# Docker skill');

    await runStartupInvalidation(store as any, skillsDir, hashesPath);

    // New skill has no cached entries, so deleteBySkill should not be called
    expect(store.deleteBySkill).not.toHaveBeenCalled();
  });
});
