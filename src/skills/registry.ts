import { loadSkillDirectory } from './loader.js';
import type { SkillFile } from './types.js';

/** Enriched skill summary returned by SkillRegistry.list() for routing decisions. */
export interface EnrichedSkillSummary {
  name: string;
  description: string;
  triggers: string[];
  negative_triggers: string[];
  when_not_to_use: string[];
  priority: number;
}

/**
 * In-memory Map-based skill registry, populated at startup from a skills directory.
 */
export class SkillRegistry {
  private skills: Map<string, SkillFile> = new Map();

  /**
   * Loads all valid skill files from dirPath and stores them by name.
   * Logs errors for malformed skill files to stderr.
   */
  populate(dirPath: string): void {
    const { skills, errors } = loadSkillDirectory(dirPath);

    for (const skill of skills) {
      this.skills.set(skill.frontmatter.name, skill);
    }

    for (const err of errors) {
      console.error(`[SkillRegistry] Failed to load ${err.file}: ${err.error}`);
    }
  }

  /** Returns a skill by name, or undefined if not found. */
  get(name: string): SkillFile | undefined {
    return this.skills.get(name);
  }

  /** Returns enriched summaries of all loaded skills for routing decisions. */
  list(): EnrichedSkillSummary[] {
    return Array.from(this.skills.values()).map(s => ({
      name: s.frontmatter.name,
      description: s.frontmatter.description,
      triggers: s.frontmatter.triggers,
      negative_triggers: s.frontmatter.negative_triggers,
      when_not_to_use: s.frontmatter.when_not_to_use,
      priority: s.frontmatter.priority,
    }));
  }

  /** Returns all loaded skill files. */
  getAll(): SkillFile[] {
    return Array.from(this.skills.values());
  }
}
