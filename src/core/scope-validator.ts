import { resolve } from 'path';
import type { SessionState } from '../agents/types.js';

// ============================================================================
// Scope Validation
// ============================================================================

export interface ScopeValidationResult {
  /** Whether the requested scope is allowed */
  allowed: boolean;
  /** Reason for rejection */
  reason?: string;
  /** Session ID that conflicts, if any */
  conflictingSessionId?: string;
}

/**
 * Validates that agent sessions don't operate on overlapping repository scopes.
 *
 * Enforces the one-repo-per-session constraint from Commandment #18
 * (Bounded Autonomous Execution) in petasum-super-petasum.
 */
export class ScopeValidator {
  /**
   * Check if a working directory is available for a new session.
   *
   * Rejects if any running or paused session has the same directory,
   * or a parent/child directory relationship.
   */
  validateRepoScope(
    workingDirectory: string,
    activeSessions: SessionState[]
  ): ScopeValidationResult {
    const normalizedTarget = resolve(workingDirectory);

    for (const session of activeSessions) {
      if (session.status !== 'running' && session.status !== 'paused') {
        continue;
      }

      const normalizedExisting = resolve(session.workingDirectory);

      // Exact match
      if (normalizedTarget === normalizedExisting) {
        return {
          allowed: false,
          reason:
            `Scope conflict: directory "${normalizedTarget}" is already in use by ` +
            `session ${session.id} (agent: ${session.agentId}). ` +
            `One-repo-per-session constraint (Commandment #18). ` +
            `If this work belongs in a different repo, capture it as a GitHub issue instead.`,
          conflictingSessionId: session.id,
        };
      }

      // Parent/child relationship — target is inside an active session's directory
      if (normalizedTarget.startsWith(normalizedExisting + '/')) {
        return {
          allowed: false,
          reason:
            `Scope conflict: directory "${normalizedTarget}" is a subdirectory of ` +
            `"${normalizedExisting}" (session ${session.id}, agent: ${session.agentId}). ` +
            `One-repo-per-session constraint (Commandment #18).`,
          conflictingSessionId: session.id,
        };
      }

      // Reverse — active session is inside the requested directory
      if (normalizedExisting.startsWith(normalizedTarget + '/')) {
        return {
          allowed: false,
          reason:
            `Scope conflict: directory "${normalizedTarget}" is a parent of ` +
            `"${normalizedExisting}" (session ${session.id}, agent: ${session.agentId}). ` +
            `One-repo-per-session constraint (Commandment #18).`,
          conflictingSessionId: session.id,
        };
      }
    }

    return { allowed: true };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let defaultScopeValidator: ScopeValidator | null = null;

export function getScopeValidator(): ScopeValidator {
  if (!defaultScopeValidator) {
    defaultScopeValidator = new ScopeValidator();
  }
  return defaultScopeValidator;
}

export function resetScopeValidator(): void {
  defaultScopeValidator = null;
}
