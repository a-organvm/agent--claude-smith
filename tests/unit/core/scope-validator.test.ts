/**
 * ScopeValidator Unit Tests
 *
 * Tests the one-repo-per-session constraint (Commandment #18, F-35).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ScopeValidator, getScopeValidator, resetScopeValidator } from '../../../src/core/scope-validator.js';
import type { SessionState } from '../../../src/agents/types.js';

function createMockSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 'session-1',
    agentId: 'test-agent',
    status: 'running',
    prompt: 'test prompt',
    workingDirectory: '/repos/my-project',
    env: {},
    childSessionIds: [],
    currentTurn: 0,
    maxTurns: 20,
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ScopeValidator', () => {
  let validator: ScopeValidator;

  beforeEach(() => {
    resetScopeValidator();
    validator = new ScopeValidator();
  });

  describe('validateRepoScope', () => {
    it('allows first session for a repo path', () => {
      const result = validator.validateRepoScope('/repos/my-project', []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('rejects second session with same workingDirectory', () => {
      const activeSessions = [
        createMockSession({ workingDirectory: '/repos/my-project' }),
      ];

      const result = validator.validateRepoScope('/repos/my-project', activeSessions);
      expect(result.allowed).toBe(false);
      expect(result.conflictingSessionId).toBe('session-1');
      expect(result.reason).toContain('Scope conflict');
      expect(result.reason).toContain('Commandment #18');
    });

    it('rejects session whose directory is child of active session', () => {
      const activeSessions = [
        createMockSession({ workingDirectory: '/repos/my-project' }),
      ];

      const result = validator.validateRepoScope('/repos/my-project/subdir', activeSessions);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('subdirectory');
    });

    it('rejects session whose directory is parent of active session', () => {
      const activeSessions = [
        createMockSession({ workingDirectory: '/repos/my-project/subdir' }),
      ];

      const result = validator.validateRepoScope('/repos/my-project', activeSessions);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('parent');
    });

    it('allows sessions for different repos', () => {
      const activeSessions = [
        createMockSession({ workingDirectory: '/repos/project-a' }),
      ];

      const result = validator.validateRepoScope('/repos/project-b', activeSessions);
      expect(result.allowed).toBe(true);
    });

    it('handles path normalization (trailing slash)', () => {
      const activeSessions = [
        createMockSession({ workingDirectory: '/repos/my-project/' }),
      ];

      const result = validator.validateRepoScope('/repos/my-project', activeSessions);
      expect(result.allowed).toBe(false);
    });

    it('handles relative paths via normalization', () => {
      const activeSessions = [
        createMockSession({ workingDirectory: '/repos/my-project' }),
      ];

      const result = validator.validateRepoScope('/repos/./my-project', activeSessions);
      expect(result.allowed).toBe(false);
    });

    it('allows after conflicting session completes', () => {
      const activeSessions = [
        createMockSession({
          workingDirectory: '/repos/my-project',
          status: 'completed',
        }),
      ];

      const result = validator.validateRepoScope('/repos/my-project', activeSessions);
      expect(result.allowed).toBe(true);
    });

    it('ignores failed sessions', () => {
      const activeSessions = [
        createMockSession({
          workingDirectory: '/repos/my-project',
          status: 'failed',
        }),
      ];

      const result = validator.validateRepoScope('/repos/my-project', activeSessions);
      expect(result.allowed).toBe(true);
    });

    it('ignores cancelled sessions', () => {
      const activeSessions = [
        createMockSession({
          workingDirectory: '/repos/my-project',
          status: 'cancelled',
        }),
      ];

      const result = validator.validateRepoScope('/repos/my-project', activeSessions);
      expect(result.allowed).toBe(true);
    });

    it('detects conflict with paused sessions', () => {
      const activeSessions = [
        createMockSession({
          workingDirectory: '/repos/my-project',
          status: 'paused',
        }),
      ];

      const result = validator.validateRepoScope('/repos/my-project', activeSessions);
      expect(result.allowed).toBe(false);
    });

    it('does not false-positive on directory name prefix match', () => {
      const activeSessions = [
        createMockSession({ workingDirectory: '/repos/my-project' }),
      ];

      // "my-project-v2" is NOT a child of "my-project"
      const result = validator.validateRepoScope('/repos/my-project-v2', activeSessions);
      expect(result.allowed).toBe(true);
    });
  });

  describe('singleton factory', () => {
    it('returns the same instance', () => {
      const a = getScopeValidator();
      const b = getScopeValidator();
      expect(a).toBe(b);
    });

    it('resets to new instance', () => {
      const a = getScopeValidator();
      resetScopeValidator();
      const b = getScopeValidator();
      expect(a).not.toBe(b);
    });
  });
});
