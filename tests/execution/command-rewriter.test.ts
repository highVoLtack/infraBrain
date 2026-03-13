import { describe, it, expect } from 'vitest';
import { rewriteForContainer, findDbContainer, stripHostFlag } from '../../src/execution/runner.js';

describe('rewriteForContainer', () => {
  const container = 'postgres-demo';

  it('wraps bare SELECT in docker exec', () => {
    expect(rewriteForContainer('SELECT count(*) FROM pg_stat_activity', container))
      .toBe('docker exec postgres-demo psql -U postgres -c "SELECT count(*) FROM pg_stat_activity"');
  });

  it('wraps bare SHOW in docker exec', () => {
    expect(rewriteForContainer('SHOW max_connections', container))
      .toBe('docker exec postgres-demo psql -U postgres -c "SHOW max_connections"');
  });

  it('wraps SELECT pg_terminate_backend', () => {
    const sql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle'";
    expect(rewriteForContainer(sql, container))
      .toBe(`docker exec postgres-demo psql -U postgres -c "${sql}"`);
  });

  it('strips trailing semicolon from SQL', () => {
    expect(rewriteForContainer('SELECT 1;', container))
      .toBe('docker exec postgres-demo psql -U postgres -c "SELECT 1"');
  });

  it('wraps bare psql command', () => {
    expect(rewriteForContainer('psql -U postgres -c "SELECT 1"', container))
      .toBe('docker exec postgres-demo psql -U postgres -c "SELECT 1"');
  });

  it('passes through docker exec commands unchanged', () => {
    const cmd = 'docker exec postgres-demo psql -U postgres -c "SELECT 1"';
    expect(rewriteForContainer(cmd, container)).toBe(cmd);
  });

  it('strips -h flag from docker exec passthrough', () => {
    const cmd = 'docker exec postgres-demo psql -U postgres -h 172.20.0.2 -c "SELECT 1"';
    expect(rewriteForContainer(cmd, container))
      .toBe('docker exec postgres-demo psql -U postgres -c "SELECT 1"');
  });

  it('strips -h flag from bare psql rewrite', () => {
    expect(rewriteForContainer('psql -U postgres -h 172.20.0.2 -c "SELECT 1"', container))
      .toBe('docker exec postgres-demo psql -U postgres -c "SELECT 1"');
  });

  it('passes through non-SQL commands unchanged', () => {
    expect(rewriteForContainer('docker ps --format "{{.Names}}"', container))
      .toBe('docker ps --format "{{.Names}}"');
  });

  it('passes through unchanged when no container provided', () => {
    expect(rewriteForContainer('SELECT 1', undefined)).toBe('SELECT 1');
  });

  it('handles WITH clause', () => {
    expect(rewriteForContainer('WITH idle AS (SELECT pid FROM pg_stat_activity) SELECT * FROM idle', container))
      .toContain('docker exec postgres-demo psql -U postgres -c');
  });

  it('handles case-insensitive SQL keywords', () => {
    expect(rewriteForContainer('select count(*) from pg_stat_activity', container))
      .toBe('docker exec postgres-demo psql -U postgres -c "select count(*) from pg_stat_activity"');
  });
});

describe('findDbContainer', () => {
  it('picks postgres-demo over leaky-app', () => {
    expect(findDbContainer(['leaky-app', 'postgres-demo'])).toBe('postgres-demo');
  });

  it('picks postgres-demo when listed first', () => {
    expect(findDbContainer(['postgres-demo', 'leaky-app'])).toBe('postgres-demo');
  });

  it('picks container with "db" in name', () => {
    expect(findDbContainer(['web-app', 'my-db-server', 'redis-cache'])).toBe('my-db-server');
  });

  it('picks container with "pg" in name', () => {
    expect(findDbContainer(['frontend', 'pg-primary'])).toBe('pg-primary');
  });

  it('picks mysql container', () => {
    expect(findDbContainer(['app', 'mysql-server'])).toBe('mysql-server');
  });

  it('picks redis container', () => {
    expect(findDbContainer(['app', 'redis-cache'])).toBe('redis-cache');
  });

  it('falls back to first container when no DB pattern found', () => {
    expect(findDbContainer(['web-frontend', 'api-gateway'])).toBe('web-frontend');
  });

  it('returns undefined for empty list', () => {
    expect(findDbContainer([])).toBeUndefined();
  });

  it('prioritizes postgres over redis', () => {
    // postgres patterns are checked first
    expect(findDbContainer(['redis-cache', 'postgres-primary'])).toBe('postgres-primary');
  });
});

describe('stripHostFlag', () => {
  it('strips -h with IP', () => {
    expect(stripHostFlag('-U postgres -h 172.20.0.2 -c "SELECT 1"'))
      .toBe('-U postgres -c "SELECT 1"');
  });

  it('strips --host with IP', () => {
    expect(stripHostFlag('-U postgres --host 172.20.0.2 -c "SELECT 1"'))
      .toBe('-U postgres -c "SELECT 1"');
  });

  it('strips --host=IP', () => {
    expect(stripHostFlag('-U postgres --host=172.20.0.2 -c "SELECT 1"'))
      .toBe('-U postgres -c "SELECT 1"');
  });

  it('leaves args without -h untouched', () => {
    expect(stripHostFlag('-U postgres -c "SELECT 1"'))
      .toBe('-U postgres -c "SELECT 1"');
  });

  it('strips -h with hostname', () => {
    expect(stripHostFlag('-U postgres -h postgres-demo -c "SELECT 1"'))
      .toBe('-U postgres -c "SELECT 1"');
  });
});
