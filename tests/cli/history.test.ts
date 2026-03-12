import { describe, it, expect } from 'vitest';
import { formatHistoryTable } from '../../src/cli/formatter.js';
import type { AuditEntry } from '../../src/audit/types.js';

const sampleEntries: AuditEntry[] = [
  {
    timestamp: '2026-03-08T10:00:00.000Z',
    sessionId: 'sess-1',
    eventType: 'decision',
    riskLevel: 'read',
    command: 'systemctl status nginx',
    reasoning: 'Service might be down, checking status first',
    diffBefore: 'active (running)',
    diffAfter: 'inactive (dead)',
  },
  {
    timestamp: '2026-03-08T10:01:00.000Z',
    sessionId: 'sess-1',
    eventType: 'command_validation',
    riskLevel: 'write',
    command: 'systemctl restart nginx',
  },
  {
    timestamp: '2026-03-08T10:02:00.000Z',
    sessionId: 'sess-1',
    eventType: 'approval',
    riskLevel: 'destructive',
    command: 'rm -rf /tmp/cache',
    decision: 'Clear cache to free disk space',
  },
  {
    timestamp: '2026-03-08T10:03:00.000Z',
    sessionId: 'sess-2',
    eventType: 'error',
    command: 'docker restart app',
  },
];

describe('formatHistoryTable', () => {
  describe('compact mode', () => {
    it('renders a header row with column labels', () => {
      const output = formatHistoryTable(sampleEntries, false);
      expect(output).toContain('TIMESTAMP');
      expect(output).toContain('TYPE');
      expect(output).toContain('RISK');
      expect(output).toContain('SUMMARY');
    });

    it('renders one line per entry in compact mode', () => {
      const output = formatHistoryTable(sampleEntries, false);
      const lines = output.split('\n').filter((l) => l.trim().length > 0);
      // header + 4 entries
      expect(lines.length).toBe(5);
    });

    it('shows event type in each row', () => {
      const output = formatHistoryTable(sampleEntries, false);
      expect(output).toContain('decision');
      expect(output).toContain('command_validation');
      expect(output).toContain('approval');
      expect(output).toContain('error');
    });

    it('shows dash for missing risk level', () => {
      const output = formatHistoryTable(sampleEntries, false);
      // The error entry has no riskLevel
      expect(output).toContain('-');
    });

    it('truncates long command/decision text', () => {
      const longEntry: AuditEntry[] = [
        {
          timestamp: '2026-03-08T10:00:00.000Z',
          sessionId: 'sess-1',
          eventType: 'decision',
          riskLevel: 'read',
          command: 'a'.repeat(200),
        },
      ];
      const output = formatHistoryTable(longEntry, false);
      // Should not contain 200 a's
      expect(output.indexOf('a'.repeat(200))).toBe(-1);
    });
  });

  describe('verbose mode', () => {
    it('shows reasoning when available', () => {
      const output = formatHistoryTable(sampleEntries, true);
      expect(output).toContain('Service might be down');
    });

    it('shows diff sections when available', () => {
      const output = formatHistoryTable(sampleEntries, true);
      expect(output).toContain('active (running)');
      expect(output).toContain('inactive (dead)');
    });

    it('includes more lines than compact mode', () => {
      const compactLines = formatHistoryTable(sampleEntries, false).split('\n').length;
      const verboseLines = formatHistoryTable(sampleEntries, true).split('\n').length;
      expect(verboseLines).toBeGreaterThan(compactLines);
    });
  });

  describe('execution event summaries', () => {
    it('shows command and result for step_complete', () => {
      const entries: AuditEntry[] = [{
        timestamp: '2026-03-08T10:00:00.000Z',
        sessionId: 'sess-1',
        eventType: 'step_complete',
        metadata: { command: 'docker network connect frontend demo-backend', exitCode: 0 },
      }];
      const output = formatHistoryTable(entries, false);
      expect(output).toContain('Executed: docker network connect frontend demo-backend');
    });

    it('shows plan summary for execution_complete', () => {
      const entries: AuditEntry[] = [{
        timestamp: '2026-03-08T10:00:00.000Z',
        sessionId: 'sess-1',
        eventType: 'execution_complete',
        metadata: { planSummary: 'Fix Nginx 502', stepsCompleted: 3 },
      }];
      const output = formatHistoryTable(entries, false);
      expect(output).toContain('Plan completed: Fix Nginx 502 (3 steps)');
    });

    it('shows entity count for discovery_complete', () => {
      const entries: AuditEntry[] = [{
        timestamp: '2026-03-08T10:00:00.000Z',
        sessionId: 'sess-1',
        eventType: 'discovery_complete',
        metadata: {
          discoveredData: {
            'Running containers': 'nginx\nbackend\nredis',
            'Docker networks': 'bridge\nfrontend',
          },
        },
      }];
      const output = formatHistoryTable(entries, false);
      expect(output).toContain('Discovery: 5 entities found');
    });

    it('shows skill name for skill_selection', () => {
      const entries: AuditEntry[] = [{
        timestamp: '2026-03-08T10:00:00.000Z',
        sessionId: 'sess-1',
        eventType: 'skill_selection',
        metadata: { skillName: 'nginx-troubleshoot' },
      }];
      const output = formatHistoryTable(entries, false);
      expect(output).toContain('Selected skill: nginx-troubleshoot');
    });
  });

  describe('empty results', () => {
    it('shows "No audit entries found" message for empty array', () => {
      const output = formatHistoryTable([], false);
      expect(output).toContain('No audit entries found');
    });
  });
});
