import { loadSkillDirectory } from './loader.js';
import type { SkillFile } from './types.js';

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

  /** Returns summaries of all loaded skills (name + description). */
  list(): Array<{ name: string; description: string }> {
    return Array.from(this.skills.values()).map(s => ({
      name: s.frontmatter.name,
      description: s.frontmatter.description,
    }));
  }

  /** Returns all loaded skill files. */
  getAll(): SkillFile[] {
    return Array.from(this.skills.values());
  }
}
