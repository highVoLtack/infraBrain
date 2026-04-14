import { describe, it, expect } from 'vitest';
import {
  extractEntitiesFromText,
  extractEntitiesForGraph,
} from '../../src/memory/entity-extractor.js';

describe('extractEntitiesFromText', () => {
  it('detects container names from diagnostic text', () => {
    const text = 'Container backend-api is unhealthy. Restarting nginx-proxy.';
    const entities = extractEntitiesFromText(text);
    const containers = entities.filter(e => e.type === 'container');
    expect(containers.length).toBeGreaterThanOrEqual(1);
    const values = containers.map(c => c.value);
    expect(values).toContain('backend-api');
    expect(values).toContain('nginx-proxy');
  });

  it('detects service names (redis, nginx, postgres, mysql) with word boundaries', () => {
    const text = 'The redis instance is down. Nginx responded with 502. Postgres connection timeout.';
    const entities = extractEntitiesFromText(text);
    const services = entities.filter(e => e.type === 'service');
    const values = services.map(s => s.value.toLowerCase());
    expect(values).toContain('redis');
    expect(values).toContain('nginx');
    expect(values).toContain('postgres');
  });

  it('detects hostnames matching common patterns (server-01, web.internal)', () => {
    const text = 'Connection to db-01.internal failed. web-02.local is unreachable.';
    const entities = extractEntitiesFromText(text);
    const hostnames = entities.filter(e => e.type === 'hostname');
    const values = hostnames.map(h => h.value);
    expect(values).toContain('db-01.internal');
    expect(values).toContain('web-02.local');
  });

  it('does NOT false-positive on "redistribution" for "redis"', () => {
    const text = 'The redistribution of load across nodes was successful.';
    const entities = extractEntitiesFromText(text);
    const services = entities.filter(e => e.type === 'service');
    const values = services.map(s => s.value.toLowerCase());
    expect(values).not.toContain('redis');
  });

  it('detects IPs from diagnostic text', () => {
    const text = 'Connection refused from 192.168.1.100 to 10.0.0.5';
    const entities = extractEntitiesFromText(text);
    const ips = entities.filter(e => e.type === 'ip');
    const values = ips.map(i => i.value);
    expect(values).toContain('192.168.1.100');
    expect(values).toContain('10.0.0.5');
  });

  it('detects ports from diagnostic text', () => {
    const text = 'Service listening on port 8080. Connection to :5432 failed.';
    const entities = extractEntitiesFromText(text);
    const ports = entities.filter(e => e.type === 'port');
    const values = ports.map(p => p.value);
    expect(values).toContain('8080');
    expect(values).toContain('5432');
  });

  it('detects error codes from diagnostic text', () => {
    const text = 'Process received SIGKILL. Container reported OOM. Connection ECONNREFUSED.';
    const entities = extractEntitiesFromText(text);
    const errors = entities.filter(e => e.type === 'error_code');
    const values = errors.map(e => e.value.toUpperCase());
    expect(values).toContain('SIGKILL');
    expect(values).toContain('OOM');
    expect(values).toContain('ECONNREFUSED');
  });
});

describe('extractEntitiesForGraph', () => {
  it('creates EntityRecord-shaped objects with incident relationship', () => {
    const discoveryRaw = {
      'Running containers': 'backend-api\nnginx-proxy',
      'Error logs': 'redis connection refused on port 6379 from 10.0.0.1',
    };
    const diagnosis = 'Redis cache on db-01.internal is down causing backend failures';
    const incidentId = 'inc-test-001';

    const records = extractEntitiesForGraph(discoveryRaw, diagnosis, incidentId);

    expect(records.length).toBeGreaterThan(0);

    // Every record should have incident relationship
    for (const record of records) {
      expect(record.related_incident_id).toBe('inc-test-001');
      expect(record.relationship_type).toBe('involved_in');
      expect(record.wing).toBe('wing_incidents');
      expect(record.valid_from).toBeTruthy();
      expect(record.valid_to).toBe('');
    }

    // Should have various entity types
    const types = new Set(records.map(r => r.entity_type));
    expect(types.size).toBeGreaterThan(1);
  });

  it('deduplicates by type+value combination', () => {
    // Same entity mentioned in both discovery and diagnosis
    const discoveryRaw = {
      'Error logs': 'redis connection failed',
    };
    const diagnosis = 'Redis service is down';

    const records = extractEntitiesForGraph(discoveryRaw, diagnosis, 'inc-001');
    const redisEntities = records.filter(
      r => r.entity_type === 'service' && r.entity_value.toLowerCase() === 'redis',
    );
    expect(redisEntities).toHaveLength(1);
  });
});
