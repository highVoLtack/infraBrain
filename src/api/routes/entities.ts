/**
 * GET /entities route
 *
 * Returns active entities from EntityStore as JSON array.
 * Graceful fallback: empty array on error (never 500).
 * No auth, no pagination -- entity counts are small.
 */

import type { Express } from 'express';
import type { EntityStore } from '../../memory/entity-store.js';

/** Minimal interface for EntityStore dependency injection (test-friendly). */
export interface EntityStoreReader {
  getActive(entityType: string, wing?: string): Promise<Array<Record<string, unknown>>>;
}

/**
 * Mount GET /entities on the given Express app.
 * entityStore.getActive() requires an entityType argument per current API.
 * We query all known entity types and merge results.
 */
export function mountEntitiesRoute(
  app: Express,
  entityStore: EntityStoreReader,
): void {
  app.get('/entities', async (_req, res) => {
    try {
      // EntityStore.getActive() takes an entityType parameter.
      // Query common entity types and merge. If store supports parameterless
      // getActive, this still works (extra arg is ignored).
      const entityTypes = ['container', 'port', 'ip', 'error_code', 'service', 'hostname'];
      const results: Array<Record<string, unknown>> = [];

      for (const type of entityTypes) {
        try {
          const entities = await entityStore.getActive(type);
          results.push(...entities);
        } catch {
          // Skip failed type queries
        }
      }

      // Deduplicate by id
      const seen = new Set<string>();
      const unique = results.filter((e) => {
        const id = e.id as string;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      res.json(unique);
    } catch (err) {
      // Graceful fallback: empty array, not 500
      res.json([]);
    }
  });
}
