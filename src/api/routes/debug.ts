import { Router } from 'express';
import type { LLMProvider } from '../../llm/types.js';
import type { AuditLogger } from '../../audit/logger.js';
import type { ValidationResult } from '../../safety/types.js';
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
 */
export function createDebugRoute(
  provider: LLMProvider,
  auditLogger: AuditLogger,
  validator: (command: string) => ValidationResult,
): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { prompt } = req.body ?? {};

      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      const sessionId = uuidv7();
      const systemPrompt = 'You are an infrastructure diagnostic assistant. Analyze the issue and suggest specific commands to investigate or resolve it. Prefix commands with "Command:" on their own line.';

      // Use generateCommand for API responses (non-streaming)
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
