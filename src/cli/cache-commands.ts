/**
 * CLI commands for cache management: list and clear cached fixes.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import type { InfraBrainConfig } from '../config/types.js';
import { getCacheStore } from '../cache/lance-store.js';
import { DEFAULT_CACHE_CONFIG } from '../cache/types.js';

/**
 * Format an ISO date string into a human-readable relative time.
 * Returns "Xs ago", "Xm ago", "Xh ago", or "Xd ago".
 */
export function formatAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

/**
 * Format a success rate from success and fail counts.
 * Returns "XX% (success/total)" or "N/A" if no attempts.
 */
export function formatSuccessRate(success: number, fail: number): string {
  const total = success + fail;
  if (total === 0) return 'N/A';
  const pct = Math.round((success / total) * 100);
  return `${pct}% (${success}/${total})`;
}

/**
 * Register cache management commands onto the commander program.
 * Adds 'cache list' and 'cache clear' subcommands.
 */
export function registerCacheCommands(program: Command, config: InfraBrainConfig): void {
  const cacheCmd = program
    .command('cache')
    .description('Manage fix cache');

  cacheCmd
    .command('list')
    .description('List all cached fixes with stats')
    .action(async () => {
      try {
        const dataDir = config.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir;
        const store = getCacheStore(dataDir);
        await store.init();
        const entries = await store.listAll();

        if (entries.length === 0) {
          console.log('No cached fixes.');
          return;
        }

        // Table header
        console.log('');
        console.log(
          chalk.bold('  Skill'.padEnd(22)) +
          chalk.bold('Age'.padEnd(12)) +
          chalk.bold('Hits'.padEnd(8)) +
          chalk.bold('Success Rate'.padEnd(18)) +
          chalk.bold('Last Used'),
        );
        console.log('  ' + '-'.repeat(70));

        for (const row of entries) {
          const skillName = String(row.skill_name ?? 'unknown').padEnd(20);
          const age = formatAge(String(row.created_at)).padEnd(12);
          const hits = String(row.hit_count ?? 0).padEnd(8);
          const successRate = formatSuccessRate(
            Number(row.success_count ?? 0),
            Number(row.fail_count ?? 0),
          ).padEnd(18);
          const lastUsed = formatAge(String(row.last_used));

          console.log(`  ${skillName}${age}${hits}${successRate}${lastUsed}`);
        }

        console.log(`\n  Total: ${entries.length} cached fix(es).\n`);
      } catch (err) {
        console.error(`Failed to list cache entries: ${(err as Error).message}`);
      }
    });

  cacheCmd
    .command('clear')
    .description('Purge all cached fixes')
    .action(async () => {
      try {
        const dataDir = config.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir;
        const store = getCacheStore(dataDir);
        await store.init();

        // Get count before clearing
        const entries = await store.listAll();
        const count = entries.length;

        await store.deleteAll();
        console.log(`Cleared ${count} cached fix(es).`);
      } catch (err) {
        console.error(`Failed to clear cache: ${(err as Error).message}`);
      }
    });
}
