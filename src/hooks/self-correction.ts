import type {
  HookContext,
  PreToolUseHookInput,
  PreToolUseHookResult,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  PostToolUseFailureHookResult,
  ToolCallRecord,
  ExtendedAgentDefinition,
} from '../agents/types.js';

// ============================================================================
// Self-Correction Hook System
// ============================================================================

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  agentId: string;
  turnNumber: number;
  event: 'pre_tool' | 'post_tool' | 'tool_failure' | 'block' | 'retry';
  toolName: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  decision?: string;
  durationMs?: number;
}

/**
 * Dangerous operation patterns to block
 */
const DANGEROUS_PATTERNS = {
  bash: {
    commands: [
      /\brm\s+-rf\s+[\/~]/,  // rm -rf with root or home paths
      /\bsudo\s/,            // sudo commands
      /\bmkfs\b/,            // filesystem formatting
      /\bdd\s+.*of=\/dev\//,  // disk operations
      /\b:\(\)\{.*\}.*;:\b/, // fork bomb
      /\bcurl.*\|\s*(?:ba)?sh/,  // curl pipe to shell
      /\bwget.*\|\s*(?:ba)?sh/,  // wget pipe to shell
    ],
    paths: [
      /^\/$/,               // root
      /^\/etc\//,           // system config
      /^\/var\/log\//,      // system logs
      /^\/boot\//,          // boot partition
    ],
  },
  write: {
    paths: [
      /^\/etc\//,
      /^\/boot\//,
      /^\/sys\//,
      /^\/proc\//,
      /\.ssh\/authorized_keys$/,
      /\.bashrc$/,
      /\.zshrc$/,
      /\.profile$/,
    ],
  },
};

/**
 * Self-correction hooks for agent safety and recovery
 */
export class SelfCorrectionHooks {
  private readonly auditLog: AuditLogEntry[] = [];
  private readonly maxAuditLogSize: number = 1000;
  private readonly onAuditEntry?: (entry: AuditLogEntry) => void;
  private failureTracker: Map<string, number> = new Map();

  constructor(options: { onAuditEntry?: (entry: AuditLogEntry) => void } = {}) {
    this.onAuditEntry = options.onAuditEntry;
  }

  /**
   * Pre-tool-use hook: Validate and potentially block dangerous operations
   */
  preToolUse(
    input: PreToolUseHookInput,
    agentDef: ExtendedAgentDefinition
  ): PreToolUseHookResult {
    const { context, toolName, toolInput } = input;

    // Check if tool is allowed for this agent
    const toolConfig = agentDef.tools.find(t => t.name === toolName);
    if (!toolConfig || !toolConfig.enabled) {
      this.logAudit({
        ...this.baseAuditEntry(context, toolName),
        event: 'block',
        input: toolInput,
        decision: `Tool '${toolName}' is not enabled for agent '${agentDef.id}'`,
      });

      return {
        allow: false,
        blockReason: `Tool '${toolName}' is not enabled for this agent`,
      };
    }

    // Validate based on tool type
    switch (toolName) {
      case 'Bash':
        return this.validateBashTool(input, toolConfig.restrictions);
      case 'Write':
      case 'Edit':
        return this.validateWriteTool(input, toolConfig.restrictions);
      default:
        return { allow: true };
    }
  }

  /**
   * Validate Bash tool usage
   */
  private validateBashTool(
    input: PreToolUseHookInput,
    restrictions?: { allowedPaths?: string[]; blockedCommands?: string[] }
  ): PreToolUseHookResult {
    const { context, toolName, toolInput } = input;
    const command = toolInput.command as string | undefined;

    if (!command) {
      return { allow: true };
    }

    // Check against dangerous command patterns
    for (const pattern of DANGEROUS_PATTERNS.bash.commands) {
      if (pattern.test(command)) {
        this.logAudit({
          ...this.baseAuditEntry(context, toolName),
          event: 'block',
          input: toolInput,
          decision: `Blocked dangerous command pattern: ${pattern}`,
        });

        return {
          allow: false,
          blockReason: `Potentially dangerous command detected. Pattern: ${pattern}`,
        };
      }
    }

    // Check blocked commands from config
    if (restrictions?.blockedCommands) {
      for (const blocked of restrictions.blockedCommands) {
        if (command.includes(blocked)) {
          this.logAudit({
            ...this.baseAuditEntry(context, toolName),
            event: 'block',
            input: toolInput,
            decision: `Blocked command: ${blocked}`,
          });

          return {
            allow: false,
            blockReason: `Command '${blocked}' is blocked by agent configuration`,
          };
        }
      }
    }

    this.logAudit({
      ...this.baseAuditEntry(context, toolName),
      event: 'pre_tool',
      input: toolInput,
      decision: 'allowed',
    });

    return { allow: true };
  }

  /**
   * Validate Write/Edit tool usage
   */
  private validateWriteTool(
    input: PreToolUseHookInput,
    restrictions?: { allowedPaths?: string[]; blockedCommands?: string[] }
  ): PreToolUseHookResult {
    const { context, toolName, toolInput } = input;
    const filePath = (toolInput.file_path || toolInput.path) as string | undefined;

    if (!filePath) {
      return { allow: true };
    }

    // Check against dangerous path patterns
    for (const pattern of DANGEROUS_PATTERNS.write.paths) {
      if (pattern.test(filePath)) {
        this.logAudit({
          ...this.baseAuditEntry(context, toolName),
          event: 'block',
          input: toolInput,
          decision: `Blocked dangerous path pattern: ${pattern}`,
        });

        return {
          allow: false,
          blockReason: `Writing to '${filePath}' is not allowed for security reasons`,
        };
      }
    }

    // Check allowed paths if configured
    if (restrictions?.allowedPaths && restrictions.allowedPaths.length > 0) {
      const isAllowed = restrictions.allowedPaths.some(allowed =>
        filePath.startsWith(allowed)
      );

      if (!isAllowed) {
        this.logAudit({
          ...this.baseAuditEntry(context, toolName),
          event: 'block',
          input: toolInput,
          decision: `Path not in allowed list`,
        });

        return {
          allow: false,
          blockReason: `Path '${filePath}' is not in the allowed paths list`,
        };
      }
    }

    this.logAudit({
      ...this.baseAuditEntry(context, toolName),
      event: 'pre_tool',
      input: toolInput,
      decision: 'allowed',
    });

    return { allow: true };
  }

  /**
   * Post-tool-use hook: Audit logging and result validation
   */
  postToolUse(input: PostToolUseHookInput): void {
    const { context, toolName, toolInput, toolOutput, durationMs } = input;

    this.logAudit({
      ...this.baseAuditEntry(context, toolName),
      event: 'post_tool',
      input: toolInput,
      output: this.sanitizeOutput(toolOutput),
      durationMs,
    });

    // Reset failure counter for this tool on success
    const toolKey = `${context.sessionId}:${toolName}`;
    this.failureTracker.delete(toolKey);
  }

  /**
   * Post-tool-use failure hook: Track failures and suggest alternatives
   */
  postToolUseFailure(
    input: PostToolUseFailureHookInput,
    retryConfig: { maxAttempts: number }
  ): PostToolUseFailureHookResult {
    const { context, toolName, toolInput, error, attemptNumber } = input;

    // Track failure count
    const toolKey = `${context.sessionId}:${toolName}`;
    const failureCount = (this.failureTracker.get(toolKey) ?? 0) + 1;
    this.failureTracker.set(toolKey, failureCount);

    const errorMessage = error.message || String(error);

    this.logAudit({
      ...this.baseAuditEntry(context, toolName),
      event: 'tool_failure',
      input: toolInput,
      error: errorMessage,
      decision: `Attempt ${attemptNumber}, total failures: ${failureCount}`,
    });

    // Determine if we should retry
    const shouldRetry = attemptNumber < retryConfig.maxAttempts;
    let alternativeAction: string | undefined;

    // Suggest alternatives based on error type
    if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
      alternativeAction = 'File or path not found. Consider using Glob to search for the file first.';
    } else if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
      alternativeAction = 'Permission denied. Check if the path is in allowed directories.';
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      alternativeAction = 'Rate limited. Waiting before retry.';
    } else if (errorMessage.includes('timeout')) {
      alternativeAction = 'Operation timed out. Consider breaking into smaller tasks.';
    }

    // Calculate retry delay with exponential backoff
    const retryDelayMs = shouldRetry ? Math.min(1000 * Math.pow(2, attemptNumber - 1), 30000) : undefined;

    return {
      shouldRetry,
      retryDelayMs,
      alternativeAction,
    };
  }

  /**
   * Create a tool call record from hook input
   */
  createToolCallRecord(
    input: PostToolUseHookInput | PostToolUseFailureHookInput,
    error?: string
  ): ToolCallRecord {
    const record: ToolCallRecord = {
      tool: input.toolName,
      input: input.toolInput,
      timestamp: new Date().toISOString(),
      durationMs: 'durationMs' in input ? input.durationMs : 0,
    };

    if ('toolOutput' in input) {
      record.output = this.sanitizeOutput(input.toolOutput);
    }

    if (error) {
      record.error = error;
    }

    return record;
  }

  /**
   * Get audit log entries
   */
  getAuditLog(): readonly AuditLogEntry[] {
    return this.auditLog;
  }

  /**
   * Get audit log entries for a specific session
   */
  getSessionAuditLog(sessionId: string): AuditLogEntry[] {
    return this.auditLog.filter(entry => entry.sessionId === sessionId);
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  /**
   * Reset failure tracking
   */
  resetFailureTracking(): void {
    this.failureTracker.clear();
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private baseAuditEntry(context: HookContext, toolName: string): Omit<AuditLogEntry, 'event'> {
    return {
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId,
      agentId: context.agentId,
      turnNumber: context.turnNumber,
      toolName,
    };
  }

  private logAudit(entry: AuditLogEntry): void {
    // Add to internal log with size limit
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog.shift();
    }

    // Call external handler if provided
    if (this.onAuditEntry) {
      this.onAuditEntry(entry);
    }
  }

  private sanitizeOutput(output: unknown): unknown {
    if (output === null || output === undefined) {
      return output;
    }

    // Truncate large string outputs
    if (typeof output === 'string' && output.length > 1000) {
      return output.substring(0, 1000) + '... [truncated]';
    }

    // For objects, do a shallow sanitization
    if (typeof output === 'object') {
      try {
        const json = JSON.stringify(output);
        if (json.length > 2000) {
          return '[large output truncated]';
        }
        return output;
      } catch {
        return '[non-serializable output]';
      }
    }

    return output;
  }
}

// Default instance
let defaultHooks: SelfCorrectionHooks | null = null;

export function getSelfCorrectionHooks(
  options?: { onAuditEntry?: (entry: AuditLogEntry) => void }
): SelfCorrectionHooks {
  if (!defaultHooks) {
    defaultHooks = new SelfCorrectionHooks(options);
  }
  return defaultHooks;
}

export function resetSelfCorrectionHooks(): void {
  defaultHooks = null;
}
