import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { SkillFrontmatterSchema } from './types.js';
import { parseSections } from './format.js';
import type { SkillFile } from './types.js';

/**
 * Loads and validates a single Markdown skill file.
 * Throws with a clear error message if the file is malformed.
 */
export function loadSkillFile(filePath: string): SkillFile {
  const raw = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  // Validate frontmatter with Zod
  let frontmatter;
  try {
    frontmatter = SkillFrontmatterSchema.parse(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Skill "${filePath}": invalid frontmatter -- ${message}`);
  }

  // Parse sections from Markdown body
  const rawSections = parseSections(content);

  if (!rawSections.systemPrompt) {
    throw new Error(`Skill "${filePath}": missing required "## System Prompt" section`);
  }

  const sections = {
    systemPrompt: rawSections.systemPrompt,
    tools: rawSections.tools,
    examples: rawSections.examples,
  };

  return {
    frontmatter,
    sections,
    rawContent: raw,
    filePath,
  };
}

/**
 * Loads all .md skill files from a directory.
 * Returns successfully loaded skills and per-file errors.
 */
export function loadSkillDirectory(dirPath: string): {
  skills: SkillFile[];
  errors: Array<{ file: string; error: string }>;
} {
  const skills: SkillFile[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  const files = readdirSync(dirPath).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = join(dirPath, file);
    try {
      skills.push(loadSkillFile(filePath));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ file: filePath, error: message });
    }
  }

  return { skills, errors };
}
