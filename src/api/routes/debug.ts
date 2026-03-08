import { Router } from 'express';
import type { LLMProvider } from '../../llm/types.js';
import type { AuditLogger } from '../../audit/logger.js';
import type { ValidationResult } from '../../safety/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import { selectSkill } from '../../orchestrator/router.js';
import { generateFixPlan, generatePlanMarkdown, formatPlanTable } from '../../orchestrator/planner.js';
import { enforceSkillAllowlist } from '../../skills/allowlist.js';
import { buildMessages } from '../../orchestrator/context.js';
import type { FixPlan } from '../../orchestrator/types.js';
import { v7 as uuidv7 } from 'uuid';

/**
 * Extract shell commands from LLM text output.
 * Looks for lines starting with common command patterns or
 * lines prefixed with "Command:" or code blocks.
 */
function extractCommands(text: string): string[] {
  const commands: string[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Match "Command: <command>" pattern
    const cmdMatch = trimmed.match(/^Command:\s*(.+)$/i);
    if (cmdMatch) {
      commands.push(cmdMatch[1].trim());
      continue;
    }

    // Match "$ <command>" pattern (shell prompt style)
    const shellMatch = trimmed.match(/^\$\s+(.+)$/);
    if (shellMatch) {
      commands.push(shellMatch[1].trim());
      continue;
    }

    // Match "`<command>`" inline code pattern
    const inlineMatch = trimmed.match(/^`([^`]+)`$/);
    if (inlineMatch) {
      commands.push(inlineMatch[1].trim());
    }
  }

  return commands;
}

/**
 * Create the /debug route.
 * Accepts a prompt, generates a diagnosis via LLM, validates any commands.
 * When a SkillRegistry is provided, uses orchestrator for skill selection and fix plans.
 */
export function createDebugRoute(
  provider: LLMProvider,
  auditLogger: AuditLogger,
  validator: (command: string) => ValidationResult,
  registry?: SkillRegistry,
): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { prompt, skill: skillOverride } = req.body ?? {};

      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      const sessionId = uuidv7();
      let skillMessage: string | undefined;
      let fixPlan: FixPlan | undefined;
      let planMarkdown: string | undefined;
      let planTable: string | undefined;

      // Determine system prompt and skill context
      let systemPrompt = 'You are an infrastructure diagnostic assistant. Analyze the issue and suggest specific commands to investigate or resolve it. Prefix commands with "Command:" on their own line.';

      // Skill selection (if registry available and has skills)
      if (registry && registry.list().length > 0) {
        try {
          const selection = await selectSkill({
            model: provider.model,
            userInput: prompt,
            registry,
            skillOverride: skillOverride as string | undefined,
          });

          skillMessage = `Using skill: ${selection.skill.frontmatter.name} -- ${selection.reasoning}`;
          auditLogger.logSkillSelection(
            selection.skill.frontmatter.name,
            selection.reasoning,
            !!skillOverride,
          );

          // Use skill's system prompt
          const { system } = buildMessages(selection.skill, prompt);
          systemPrompt = system;

          // Generate diagnosis with skill context
          const diagnosis = await provider.generateCommand(prompt, systemPrompt);

          // If the selected skill is "planning", generate a fix plan
          if (selection.skill.frontmatter.name === 'planning') {
            try {
              fixPlan = await generateFixPlan({
                model: provider.model,
                skill: selection.skill,
                userInput: prompt,
                diagnosis,
              });
              planMarkdown = generatePlanMarkdown(fixPlan);
              planTable = formatPlanTable(fixPlan);
            } catch (planErr) {
              auditLogger.logError(`Fix plan generation failed: ${(planErr as Error).message}`);
            }
          }

          // Extract and validate commands with per-skill allowlist
          const extractedCommands = extractCommands(diagnosis);
          const commands = extractedCommands.map((cmd) => {
            // Per-skill allowlist check first
            const allowlistResult = enforceSkillAllowlist(cmd, selection.skill);
            if (!allowlistResult.allowed) {
              auditLogger.logCommandValidation(cmd, 'blocked', false, allowlistResult.reason);
              return {
                command: cmd,
                riskLevel: 'blocked' as const,
                allowed: false,
                reason: allowlistResult.reason,
              };
            }

            // Global safety validator
            const result = validator(cmd);
            auditLogger.logCommandValidation(cmd, result.riskLevel, result.allowed, result.reason);
            return {
              command: cmd,
              riskLevel: result.riskLevel,
              allowed: result.allowed,
              reason: result.reason,
            };
          });

          auditLogger.logDecision(
            `Debug request: "${prompt}"`,
            [`Generated ${extractedCommands.length} commands`, `Skill: ${selection.skill.frontmatter.name}`],
            'diagnosis_complete',
          );

          res.json({
            sessionId,
            skillMessage,
            diagnosis,
            commands,
            ...(fixPlan && { fixPlan }),
            ...(planMarkdown && { planMarkdown }),
            ...(planTable && { planTable }),
          });
          return;
        } catch (skillErr) {
          // Graceful degradation: fall through to direct LLM call
          auditLogger.logError(`Skill selection failed, falling back to direct LLM: ${(skillErr as Error).message}`);
        }
      }

      // Fallback: direct LLM call (no skills loaded or skill selection failed)
      const diagnosis = await provider.generateCommand(prompt, systemPrompt);

      // Extract and validate commands
      const extractedCommands = extractCommands(diagnosis);
      const commands = extractedCommands.map((cmd) => {
        const result = validator(cmd);
        auditLogger.logCommandValidation(cmd, result.riskLevel, result.allowed, result.reason);
        return {
          command: cmd,
          riskLevel: result.riskLevel,
          allowed: result.allowed,
          reason: result.reason,
        };
      });

      auditLogger.logDecision(
        `Debug request: "${prompt}"`,
        [`Generated ${extractedCommands.length} commands`],
        'diagnosis_complete',
      );

      res.json({ sessionId, diagnosis, commands });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
