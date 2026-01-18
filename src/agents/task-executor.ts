import type { ExtendedAgentDefinition } from './types.js';
import { DEFAULT_RETRY_CONFIG } from './types.js';

/**
 * Task Executor Agent
 *
 * General-purpose agent for executing software development tasks.
 * Has full read/write access and can execute commands.
 */
export const TASK_EXECUTOR_AGENT: ExtendedAgentDefinition = {
  id: 'task-executor',
  name: 'Task Executor',
  description: 'General-purpose agent for executing software development tasks including code changes and commands',
  category: 'task-execution',
  capabilities: ['read-files', 'write-files', 'execute-commands'],

  systemPrompt: `You are an expert software developer tasked with completing development tasks efficiently and correctly.

Your capabilities:
- Read, write, and edit files
- Execute shell commands (git, npm, build tools, etc.)
- Search and navigate codebases
- Implement features, fix bugs, and refactor code

Guidelines for task execution:
1. Understand the task fully before starting
2. Plan your approach before making changes
3. Make minimal, focused changes
4. Test your changes when possible
5. Handle errors gracefully

When writing code:
- Follow existing code style and patterns in the project
- Write clear, maintainable code
- Add appropriate error handling
- Consider edge cases
- Don't break existing functionality

When executing commands:
- Use safe command patterns
- Avoid destructive operations unless explicitly requested
- Check command success/failure
- Handle command output appropriately

Best practices:
- Make atomic changes (one logical change at a time)
- Verify changes work before moving on
- Keep the user informed of progress
- Ask for clarification if requirements are unclear

Output format:
1. Acknowledge the task
2. Outline your plan
3. Execute each step with status updates
4. Summarize what was done
5. Note any issues or recommendations`,

  tools: [
    { name: 'Read', enabled: true },
    {
      name: 'Write',
      enabled: true,
      restrictions: {
        allowedPaths: ['.'], // Configured at runtime based on working directory
      },
    },
    {
      name: 'Edit',
      enabled: true,
      restrictions: {
        allowedPaths: ['.'],
      },
    },
    {
      name: 'Bash',
      enabled: true,
      restrictions: {
        blockedCommands: ['rm -rf /', 'sudo', ':(){', '> /dev/sda'],
      },
    },
    { name: 'Glob', enabled: true },
    { name: 'Grep', enabled: true },
  ],

  retryConfig: {
    ...DEFAULT_RETRY_CONFIG,
    maxAttempts: 3,
    retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR', 'ENOENT'],
  },

  secretRefs: [
    {
      name: 'ANTHROPIC_API_KEY',
      ref: 'op://Development/anthropic/api-key',
      required: true,
    },
  ],

  maxExecutionTimeMs: 600000, // 10 minutes
  maxTurns: 50,
  model: 'claude-sonnet-4-20250514',
  canSpawnSubagents: true,
  allowedSubagents: ['code-reviewer', 'security-auditor'],
};

export default TASK_EXECUTOR_AGENT;
