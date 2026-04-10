/**
 * Ground truth extraction and pinning for context management.
 * Auto-detects container names, ports, IPs, and error codes from discovery output.
 * Supports explicit [PIN]...[/PIN] markers for custom pinned facts.
 */

import { countTokens } from './token-counter.js';
import { extractContainerNames } from '../orchestrator/diagnosis.js';
import type { PinnedFact } from './types.js';

// ---------------------------------------------------------------------------
// Extraction regexes
// ---------------------------------------------------------------------------

const PORT_RE = /(?::\s*|port\s+)(\d{2,5})\b/gi;
const IP_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
const ERROR_CODE_RE = /\b(OOM|ECONNREFUSED|EPERM|ENOENT|EACCES|SIGKILL|SIGTERM|exit\s+code\s+\d+)\b/gi;
const PIN_RE = /\[PIN\](.*?)\[\/PIN\]/gs;

const EXCLUDED_IPS = new Set(['0.0.0.0', '127.0.0.1']);

// ---------------------------------------------------------------------------
// Eviction priority (lower = evicted first when over budget)
// ---------------------------------------------------------------------------

const EVICTION_PRIORITY: Record<PinnedFact['type'], number> = {
  ip: 0,
  port: 1,
  container: 2,
  custom: 3,
  error_code: 4,
};

// ---------------------------------------------------------------------------
// Extraction functions
// ---------------------------------------------------------------------------

let _nextId = 1;
function makeId(): string {
  return `gt-${_nextId++}`;
}

/**
 * Extract ground truth facts (containers, ports, IPs, error codes) from raw
 * discovery output. Deduplicates by value.
 */
export function extractGroundTruth(discoveryRaw: Record<string, string>): PinnedFact[] {
  const seen = new Set<string>();
  const facts: PinnedFact[] = [];
  const now = Date.now();

  function addFact(type: PinnedFact['type'], value: string): void {
    const key = `${type}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({
      id: makeId(),
      type,
      value,
      tokens: countTokens(value),
      pinnedAt: now,
    });
  }

  // Containers (reuse existing extractor)
  const containers = extractContainerNames(discoveryRaw);
  for (const c of containers) addFact('container', c);

  // Scan all values for ports, IPs, error codes
  const allText = Object.values(discoveryRaw).join('\n');

  // Ports
  let match: RegExpExecArray | null;
  PORT_RE.lastIndex = 0;
  while ((match = PORT_RE.exec(allText)) !== null) {
    addFact('port', match[1]);
  }

  // IPs
  IP_RE.lastIndex = 0;
  while ((match = IP_RE.exec(allText)) !== null) {
    if (!EXCLUDED_IPS.has(match[1])) {
      addFact('ip', match[1]);
    }
  }

  // Error codes
  ERROR_CODE_RE.lastIndex = 0;
  while ((match = ERROR_CODE_RE.exec(allText)) !== null) {
    addFact('error_code', match[1]);
  }

  return facts;
}

/**
 * Parse explicit [PIN]...[/PIN] markers from text and return custom pinned facts.
 */
export function parseExplicitPins(text: string): PinnedFact[] {
  const facts: PinnedFact[] = [];
  const now = Date.now();

  PIN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PIN_RE.exec(text)) !== null) {
    const value = match[1];
    facts.push({
      id: makeId(),
      type: 'custom',
      value,
      tokens: countTokens(value),
      pinnedAt: now,
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// GroundTruthManager
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<PinnedFact['type'], string> = {
  container: 'Containers',
  port: 'Ports',
  ip: 'IPs',
  error_code: 'Error Codes',
  custom: 'Pinned',
};

/**
 * Manages pinned ground truth facts with a token budget cap.
 * FIFO eviction with type-based priority (IPs first, error_codes last).
 */
export class GroundTruthManager {
  private facts: PinnedFact[] = [];
  private readonly capTokens: number;

  constructor(
    private readonly capRatio: number,
    private readonly windowSize: number,
  ) {
    this.capTokens = Math.floor(windowSize * capRatio);
  }

  /**
   * Add a pinned fact. If the token budget is exceeded, evict lowest-priority
   * facts first (IPs -> ports -> containers -> custom -> error_codes).
   * Within the same priority tier, oldest facts are evicted first (FIFO).
   */
  add(fact: PinnedFact): void {
    this.facts.push(fact);
    this.enforceCapacity();
  }

  /** Total tokens used by all pinned facts. */
  getTokens(): number {
    return this.facts.reduce((sum, f) => sum + f.tokens, 0);
  }

  /** Return all currently pinned facts. */
  getFacts(): PinnedFact[] {
    return [...this.facts];
  }

  /**
   * Build a formatted section string for context injection.
   * Groups facts by type for readability.
   */
  buildSection(): string {
    const groups = new Map<PinnedFact['type'], string[]>();
    for (const f of this.facts) {
      if (!groups.has(f.type)) groups.set(f.type, []);
      groups.get(f.type)!.push(f.value);
    }

    const lines: string[] = ['## Ground Truth'];
    const typeOrder: PinnedFact['type'][] = ['error_code', 'container', 'port', 'ip', 'custom'];
    for (const type of typeOrder) {
      const values = groups.get(type);
      if (values && values.length > 0) {
        lines.push(`${TYPE_LABELS[type]}: ${values.join(', ')}`);
      }
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Evict facts until total tokens <= capTokens.
   * Eviction order: lowest priority first, then oldest within same priority.
   */
  private enforceCapacity(): void {
    while (this.getTokens() > this.capTokens && this.facts.length > 0) {
      // Sort candidates by eviction priority (ascending) then by pinnedAt (ascending = oldest first)
      let victimIdx = 0;
      let victimPriority = EVICTION_PRIORITY[this.facts[0].type];
      let victimTime = this.facts[0].pinnedAt;

      for (let i = 1; i < this.facts.length; i++) {
        const p = EVICTION_PRIORITY[this.facts[i].type];
        const t = this.facts[i].pinnedAt;
        if (p < victimPriority || (p === victimPriority && t < victimTime)) {
          victimIdx = i;
          victimPriority = p;
          victimTime = t;
        }
      }

      this.facts.splice(victimIdx, 1);
    }
  }
}
