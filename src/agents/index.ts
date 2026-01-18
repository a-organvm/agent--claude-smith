/**
 * Agent definitions index
 *
 * This file exports all built-in agent definitions and provides
 * utilities for registering them with the orchestrator.
 */

export * from './types.js';

export { default as CODE_REVIEWER_AGENT } from './code-reviewer.js';
export { default as TASK_EXECUTOR_AGENT } from './task-executor.js';
export { default as SECURITY_AUDITOR_AGENT } from './security-auditor.js';
export { default as AI_BRIDGE_AGENT } from './ai-bridge.js';

import type { ExtendedAgentDefinition } from './types.js';
import CODE_REVIEWER_AGENT from './code-reviewer.js';
import TASK_EXECUTOR_AGENT from './task-executor.js';
import SECURITY_AUDITOR_AGENT from './security-auditor.js';
import AI_BRIDGE_AGENT from './ai-bridge.js';

/**
 * All built-in agent definitions
 */
export const BUILTIN_AGENTS: ExtendedAgentDefinition[] = [
  CODE_REVIEWER_AGENT,
  TASK_EXECUTOR_AGENT,
  SECURITY_AUDITOR_AGENT,
  AI_BRIDGE_AGENT,
];

/**
 * Get a built-in agent by ID
 */
export function getBuiltinAgent(agentId: string): ExtendedAgentDefinition | undefined {
  return BUILTIN_AGENTS.find(agent => agent.id === agentId);
}

/**
 * Get all built-in agent IDs
 */
export function getBuiltinAgentIds(): string[] {
  return BUILTIN_AGENTS.map(agent => agent.id);
}
