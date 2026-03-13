import { describe, it, expect, vi } from 'vitest';
import { requestApproval, extractTarget } from '../../src/cli/approval.js';
import { RiskLevel } from '../../src/safety/types.js';

function createMockReadline(answers: string[]) {
  let callIndex = 0;
  return {
    question: vi.fn(async () => {
      return answers[callIndex++] ?? '';
    }),
    close: vi.fn(),
  } as any;
}

describe('extractTarget', () => {
  it('extracts container name from "docker rm -f nginx"', () => {
    expect(extractTarget('docker rm -f nginx')).toBe('nginx');
  });

  it('extracts file path from "rm /tmp/file.txt"', () => {
    expect(extractTarget('rm /tmp/file.txt')).toBe('/tmp/file.txt');
  });

  it('extracts container name from docker exec (not the SQL command)', () => {
    expect(extractTarget('docker exec postgres-demo psql -U postgres -c "SELECT pg_terminate_backend(pid)"'))
      .toBe('postgres-demo');
  });

  it('extracts container name from docker exec with -u flag', () => {
    expect(extractTarget('docker exec -u postgres postgres-demo psql -c "SELECT 1"'))
      .toBe('postgres-demo');
  });

  it('extracts container name from simple docker exec', () => {
    expect(extractTarget('docker exec mycontainer ls /tmp'))
      .toBe('mycontainer');
  });

  it('extracts container from docker stop', () => {
    expect(extractTarget('docker stop redis-server')).toBe('redis-server');
  });

  it('extracts container from docker restart', () => {
    expect(extractTarget('docker restart storage-redis')).toBe('storage-redis');
  });
});

describe('requestApproval', () => {
  describe('READ risk level', () => {
    it('returns approved=true without prompting (auto-approve)', async () => {
      const rl = createMockReadline([]);
      const result = await requestApproval('docker ps', RiskLevel.READ, rl);

      expect(result.approved).toBe(true);
      expect(result.approvalType).toBe('auto');
      expect(result.riskLevel).toBe(RiskLevel.READ);
      expect(result.command).toBe('docker ps');
      expect(rl.question).not.toHaveBeenCalled();
    });
  });

  describe('WRITE risk level', () => {
    it('prompts with [Y/n] and empty input (enter) returns approved=true', async () => {
      const rl = createMockReadline(['']);
      const result = await requestApproval('docker restart nginx', RiskLevel.WRITE, rl);

      expect(result.approved).toBe(true);
      expect(result.approvalType).toBe('y_n');
      expect(rl.question).toHaveBeenCalledOnce();
    });

    it('user answers "n" returns approved=false', async () => {
      const rl = createMockReadline(['n']);
      const result = await requestApproval('docker restart nginx', RiskLevel.WRITE, rl);

      expect(result.approved).toBe(false);
      expect(result.approvalType).toBe('y_n');
    });

    it('user answers "Y" returns approved=true', async () => {
      const rl = createMockReadline(['Y']);
      const result = await requestApproval('docker restart nginx', RiskLevel.WRITE, rl);

      expect(result.approved).toBe(true);
      expect(result.approvalType).toBe('y_n');
    });
  });

  describe('DESTRUCTIVE risk level', () => {
    it('asks to type target name, correct target returns approved=true', async () => {
      const rl = createMockReadline(['nginx']);
      const result = await requestApproval('docker rm -f nginx', RiskLevel.DESTRUCTIVE, rl);

      expect(result.approved).toBe(true);
      expect(result.approvalType).toBe('typed_confirmation');
      expect(rl.question).toHaveBeenCalledOnce();
    });

    it('wrong text typed returns approved=false', async () => {
      const rl = createMockReadline(['wrong-text']);
      const result = await requestApproval('docker rm -f nginx', RiskLevel.DESTRUCTIVE, rl);

      expect(result.approved).toBe(false);
      expect(result.approvalType).toBe('typed_confirmation');
    });
  });

  describe('BLOCKED risk level', () => {
    it('returns approved=false without prompting', async () => {
      const rl = createMockReadline([]);
      const result = await requestApproval('rm -rf /', RiskLevel.BLOCKED, rl);

      expect(result.approved).toBe(false);
      expect(result.approvalType).toBe('blocked');
      expect(result.riskLevel).toBe(RiskLevel.BLOCKED);
      expect(rl.question).not.toHaveBeenCalled();
    });
  });
});
