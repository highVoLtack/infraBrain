import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillRegistry } from '../../src/skills/registry.js';
import { preFilterSkills } from '../../src/orchestrator/router.js';
import { needsShell } from '../../src/execution/runner.js';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Agnostic Discovery Test — proves the engine works with ANY container name and ANY path.
 *
 * Creates a unique Docker scenario at test time with:
 * - Random container name (e.g., "ib-test-7f3a2b")
 * - Random data path (e.g., "/opt/random-7f3a2b/cache")
 * - Same permission trap pattern (root-owned dir, non-root user)
 *
 * Then verifies the full chain WITHOUT any hardcoded values:
 * 1. Discovery finds the container and its error logs
 * 2. Pre-filter routes to linux-expert (not log-analysis)
 * 3. Discovered values are real (not placeholders)
 * 4. Fix (chown) actually resolves the issue
 */
describe('Agnostic Discovery: Random Container + Random Path', { timeout: 120_000 }, () => {
  // Generate unique identifiers — no test run reuses these
  const testId = Math.random().toString(36).slice(2, 8);
  const containerName = `ib-test-${testId}`;
  const dataPath = `/opt/random-${testId}/cache`;
  let tmpComposeDir: string;

  beforeAll(() => {
    // 1. Create temp directory with a unique docker-compose
    tmpComposeDir = join(tmpdir(), `infrabrain-agnostic-${testId}`);
    mkdirSync(tmpComposeDir, { recursive: true });

    // 2. Write docker-compose.yml using our parameterized Dockerfile
    const composeContent = `services:
  ${containerName}:
    build:
      context: ${join(PROJECT_ROOT, 'demo/permission-trap/app')}
      args:
        DATA_DIR: ${dataPath}
    container_name: ${containerName}
    environment:
      - DATA_DIR=${dataPath}
`;
    writeFileSync(join(tmpComposeDir, 'docker-compose.yml'), composeContent);

    // 3. Start the broken environment
    execSync('docker compose up -d --build --wait', {
      cwd: tmpComposeDir,
      timeout: 60_000,
      stdio: 'pipe',
    });

    // 4. Wait for container to show Permission Denied
    let ready = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const logs = execSync(`docker logs ${containerName} 2>&1`, {
          timeout: 5_000,
          stdio: 'pipe',
        }).toString();
        if (logs.includes('Permission denied')) {
          ready = true;
          break;
        }
      } catch {
        // Not ready yet
      }
      execSync('sleep 1');
    }
    if (!ready) throw new Error(`Container ${containerName} never showed Permission denied`);
  }, 120_000);

  afterAll(() => {
    // Tear down
    try {
      execSync(`docker compose down --remove-orphans`, {
        cwd: tmpComposeDir,
        timeout: 30_000,
        stdio: 'pipe',
      });
    } catch { /* best-effort */ }
    try {
      rmSync(tmpComposeDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it('container is running with a unique random name and path', () => {
    const status = execSync(
      `docker inspect --format '{{.State.Status}}' ${containerName}`,
      { timeout: 5_000, stdio: 'pipe' },
    ).toString().trim();
    expect(status).toBe('running');

    // Verify the DATA_DIR is our random path
    const envPath = execSync(
      `docker exec ${containerName} printenv DATA_DIR`,
      { timeout: 5_000, stdio: 'pipe' },
    ).toString().trim();
    expect(envPath).toBe(dataPath);
  });

  it('linux-expert discovery finds container and error logs dynamically', () => {
    const registry = new SkillRegistry();
    registry.populate(join(PROJECT_ROOT, 'skills'));
    const linuxExpert = registry.get('linux-expert');
    expect(linuxExpert).toBeDefined();

    // Run each discovery command and verify results contain our container
    const discoveryCommands = linuxExpert!.frontmatter.discovery;
    expect(discoveryCommands.length).toBeGreaterThanOrEqual(3);

    // Container Inventory
    const inventoryCmd = discoveryCommands[0];
    const inventory = execSync(inventoryCmd.command, { timeout: 10_000, stdio: 'pipe' }).toString();
    expect(inventory).toContain(containerName);

    // Container Error Logs (shell command)
    const logsCmd = discoveryCommands[2];
    expect(needsShell(logsCmd.command)).toBe(true);
    const errorLogs = execSync(logsCmd.command, {
      timeout: 15_000,
      stdio: 'pipe',
      shell: '/bin/sh',
    }).toString();
    expect(errorLogs).toContain(containerName);
    expect(errorLogs).toContain('Permission denied');
    expect(errorLogs).toContain(dataPath);
  });

  it('pre-filter passes German prompt to LLM (no English trigger match = all skills)', () => {
    const registry = new SkillRegistry();
    registry.populate(join(PROJECT_ROOT, 'skills'));
    const enrichedSkills = registry.list();

    // Vague German prompt has no English trigger keywords — pre-filter returns all skills
    // as safety net, LLM handles the final routing decision. This is correct behavior.
    const candidates = preFilterSkills(enrichedSkills, 'mein Container kann nicht schreiben');
    expect(candidates.length).toBe(enrichedSkills.length);
  });

  it('pre-filter routes English permission prompt correctly', () => {
    const registry = new SkillRegistry();
    registry.populate(join(PROJECT_ROOT, 'skills'));
    const enrichedSkills = registry.list();

    const candidates = preFilterSkills(enrichedSkills, 'permission denied on /app/data');
    const candidateNames = candidates.map(s => s.name);

    expect(candidateNames).toContain('linux-expert');
    expect(candidateNames).not.toContain('log-analysis');
  });

  it('discovery contains zero hardcoded values — all are runtime-discovered', () => {
    // Run the full error logs discovery
    const registry = new SkillRegistry();
    registry.populate(join(PROJECT_ROOT, 'skills'));
    const linuxExpert = registry.get('linux-expert');
    const logsCmd = linuxExpert!.frontmatter.discovery[2];

    const errorLogs = execSync(logsCmd.command, {
      timeout: 15_000,
      stdio: 'pipe',
      shell: '/bin/sh',
    }).toString();

    // These values were generated at test time — if they appear in discovery,
    // it proves the engine discovers them dynamically
    expect(errorLogs).toContain(containerName); // random name
    expect(errorLogs).toContain(dataPath);      // random path

    // Verify no "classic" hardcoded values leak through
    expect(errorLogs).not.toContain('permission-app');
    expect(errorLogs).not.toContain('/app/data/status.pid');
  });

  it('chown fix resolves the permission issue on the random path', () => {
    // 1. Confirm broken state
    const uid = execSync(
      `docker exec ${containerName} id -u`,
      { timeout: 5_000, stdio: 'pipe' },
    ).toString().trim();
    expect(uid).toBe('1000');

    const ownerBefore = execSync(
      `docker exec ${containerName} stat -c '%U:%G' ${dataPath}`,
      { timeout: 5_000, stdio: 'pipe' },
    ).toString().trim();
    expect(ownerBefore).toBe('root:root');

    // 2. Apply fix — exactly what the engine would generate
    execSync(
      `docker exec -u 0 ${containerName} chown 1000:1000 ${dataPath}`,
      { timeout: 5_000, stdio: 'pipe' },
    );

    // 3. Verify fix
    const ownerAfter = execSync(
      `docker exec ${containerName} stat -c '%u:%g' ${dataPath}`,
      { timeout: 5_000, stdio: 'pipe' },
    ).toString().trim();
    expect(ownerAfter).toBe('1000:1000');

    // 4. Verify write access restored
    execSync(
      `docker exec ${containerName} touch ${dataPath}/test-write`,
      { timeout: 5_000, stdio: 'pipe' },
    );

    // 5. Restart and verify recovery
    execSync(`docker restart ${containerName}`, { timeout: 30_000, stdio: 'pipe' });

    // Poll for recovery
    let recovered = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const logs = execSync(`docker logs ${containerName} --tail 10 2>&1`, {
        timeout: 5_000,
        stdio: 'pipe',
      }).toString();
      if (logs.includes('written successfully')) {
        recovered = true;
        break;
      }
      execSync('sleep 1');
    }
    expect(recovered).toBe(true);
  });
});
