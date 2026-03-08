import { Router } from 'express';
import type { WriteThrough } from '../../state/store.js';
import { parseTimeInput } from '../../cli/time-parser.js';

export interface HistoryRouteDeps {
  store: WriteThrough;
}

/**
 * Create the /history route.
 * GET / returns filtered audit log entries.
 * Query params: session, type, risk, since, until, limit, verbose
 */
export function createHistoryRoute(deps: HistoryRouteDeps): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { session, type, risk, since, until, limit, verbose } = req.query as Record<string, string | undefined>;

    const filters: Record<string, unknown> = {};

    if (session) filters.sessionId = session;
    if (type) filters.eventType = type;
    if (risk) filters.riskLevel = risk;
    if (since) filters.since = parseTimeInput(since);
    if (until) filters.until = parseTimeInput(until);
    if (limit) filters.limit = parseInt(limit, 10);

    const entries = deps.store.queryAuditLog(filters);

    const appliedFilters: Record<string, string> = {};
    if (session) appliedFilters.session = session;
    if (type) appliedFilters.type = type;
    if (risk) appliedFilters.risk = risk;
    if (since) appliedFilters.since = since;
    if (until) appliedFilters.until = until;

    res.json({
      entries,
      count: entries.length,
      filters: appliedFilters,
      verbose: verbose === 'true',
    });
  });

  return router;
}
