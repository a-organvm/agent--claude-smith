import { z } from 'zod';

// ============================================================================
// Secret Reference Types
// ============================================================================

/**
 * Reference to a secret stored in 1Password
 * Format: op://<vault>/<item>/<field>
 */
export interface SecretReference {
  /** Friendly name for the secret (used as env var name) */
  name: string;
  /** 1Password reference URI (op://vault/item/field) */
  ref: string;
  /** Whether this secret is required for the agent to function */
  required: boolean;
}

export const SecretReferenceSchema = z.object({
  name: z.string().min(1),
  ref: z.string().regex(/^op:\/\/[^/]+\/[^/]+\/[^/]+$/, 'Invalid 1Password reference format'),
  required: z.boolean(),
});

// ============================================================================
// Retry Configuration
// ============================================================================

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Error types that should trigger a retry */
  retryableErrors: string[];
}

export const RetryConfigSchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  initialDelayMs: z.number().int().min(100).max(60000).default(1000),
  maxDelayMs: z.number().int().min(1000).max(300000).default(30000),
  backoffMultiplier: z.number().min(1).max(5).default(2),
  retryableErrors: z.array(z.string()).default(['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR']),
});

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR'],
};

// ============================================================================
// Agent Category & Capabilities
// ============================================================================

export type AgentCategory =
  | 'code-analysis'
  | 'task-execution'
  | 'security'
  | 'integration'
  | 'orchestration';

export type AgentCapability =
  | 'read-files'
  | 'write-files'
  | 'execute-commands'
  | 'network-access'
  | 'spawn-subagents'
  | 'external-api';

// ============================================================================
// Tool Definitions
// ============================================================================

export type ToolName =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Bash'
  | 'Glob'
  | 'Grep'
  | 'Task'
  | 'WebFetch'
  | 'WebSearch';

export interface ToolConfig {
  name: ToolName;
  /** Whether this tool is enabled for the agent */
  enabled: boolean;
  /** Optional restrictions on the tool usage */
  restrictions?: {
    /** Paths the tool can access (for file operations) */
    allowedPaths?: string[];
    /** Commands that are blocked (for Bash) */
    blockedCommands?: string[];
  };
}

// ============================================================================
// Extended Agent Definition
// ============================================================================

/**
 * Extended agent definition with orchestrator-specific fields
 */
export interface ExtendedAgentDefinition {
  /** Unique identifier for the agent */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the agent's purpose */
  description: string;
  /** Category for grouping agents */
  category: AgentCategory;
  /** Capabilities this agent has */
  capabilities: AgentCapability[];
  /** System prompt for the agent */
  systemPrompt: string;
  /** Tools available to the agent */
  tools: ToolConfig[];
  /** Retry configuration for this agent */
  retryConfig: RetryConfig;
  /** Secrets required by this agent */
  secretRefs: SecretReference[];
  /** Maximum execution time in milliseconds */
  maxExecutionTimeMs: number;
  /** Maximum number of turns before forcing completion */
  maxTurns: number;
  /** Model to use (defaults to claude-sonnet-4-20250514) */
  model?: string;
  /** Whether this agent can spawn subagents */
  canSpawnSubagents: boolean;
  /** IDs of agents this agent can spawn */
  allowedSubagents?: string[];
}

export const ExtendedAgentDefinitionSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['code-analysis', 'task-execution', 'security', 'integration', 'orchestration']),
  capabilities: z.array(z.enum(['read-files', 'write-files', 'execute-commands', 'network-access', 'spawn-subagents', 'external-api'])),
  systemPrompt: z.string().min(1),
  tools: z.array(z.object({
    name: z.enum(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch']),
    enabled: z.boolean(),
    restrictions: z.object({
      allowedPaths: z.array(z.string()).optional(),
      blockedCommands: z.array(z.string()).optional(),
    }).optional(),
  })),
  retryConfig: RetryConfigSchema,
  secretRefs: z.array(SecretReferenceSchema),
  maxExecutionTimeMs: z.number().int().min(1000).max(3600000).default(300000),
  maxTurns: z.number().int().min(1).max(100).default(20),
  model: z.string().optional(),
  canSpawnSubagents: z.boolean().default(false),
  allowedSubagents: z.array(z.string()).optional(),
});

// ============================================================================
// Agent Spawn Request & Result
// ============================================================================

export interface AgentSpawnRequest {
  /** ID of the agent to spawn */
  agentId: string;
  /** Prompt/task for the agent */
  prompt: string;
  /** Optional working directory */
  workingDirectory?: string;
  /** Optional environment variables */
  env?: Record<string, string>;
  /** Optional session ID for resumption */
  sessionId?: string;
  /** Parent session ID (for subagent tracking) */
  parentSessionId?: string;
  /** Optional timeout override */
  timeoutMs?: number;
}

export const AgentSpawnRequestSchema = z.object({
  agentId: z.string().min(1),
  prompt: z.string().min(1),
  workingDirectory: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  sessionId: z.string().optional(),
  parentSessionId: z.string().optional(),
  timeoutMs: z.number().int().min(1000).optional(),
});

export type AgentResultStatus =
  | 'success'
  | 'error'
  | 'timeout'
  | 'cancelled'
  | 'max_turns_reached';

export interface AgentResult {
  /** Session ID for this execution */
  sessionId: string;
  /** Agent ID that was executed */
  agentId: string;
  /** Status of the execution */
  status: AgentResultStatus;
  /** Result data if successful */
  result?: string;
  /** Error message if failed */
  error?: string;
  /** Number of turns taken */
  turnsTaken: number;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Subagent results if any were spawned */
  subagentResults?: AgentResult[];
  /** Metadata from execution */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Session Types
// ============================================================================

export type SessionStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SessionState {
  /** Unique session identifier */
  id: string;
  /** Agent ID being executed */
  agentId: string;
  /** Current status */
  status: SessionStatus;
  /** Original prompt */
  prompt: string;
  /** Working directory */
  workingDirectory: string;
  /** Environment variables */
  env: Record<string, string>;
  /** Parent session ID if this is a subagent */
  parentSessionId?: string;
  /** Child session IDs */
  childSessionIds: string[];
  /** Current turn number */
  currentTurn: number;
  /** Maximum turns allowed */
  maxTurns: number;
  /** Conversation history (message pairs) */
  conversationHistory: ConversationMessage[];
  /** Checkpoint data for resumption */
  checkpoint?: CheckpointData;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Completion timestamp if finished */
  completedAt?: string;
  /** Error information if failed */
  error?: SessionError;
  /** Final result if completed */
  result?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  turnNumber: number;
}

export interface CheckpointData {
  /** Last successful turn */
  lastTurn: number;
  /** Partial result so far */
  partialResult?: string;
  /** Tool call history */
  toolCallHistory: ToolCallRecord[];
  /** Timestamp of checkpoint */
  timestamp: string;
}

export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  timestamp: string;
  durationMs: number;
}

export interface SessionError {
  code: string;
  message: string;
  recoverable: boolean;
  retryCount: number;
  lastRetryAt?: string;
}

// ============================================================================
// Hook Types
// ============================================================================

export interface HookContext {
  sessionId: string;
  agentId: string;
  turnNumber: number;
  workingDirectory: string;
  env: Record<string, string>;
}

export interface PreToolUseHookInput {
  context: HookContext;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface PreToolUseHookResult {
  /** Whether to allow the tool call */
  allow: boolean;
  /** Modified input if any changes needed */
  modifiedInput?: Record<string, unknown>;
  /** Reason if blocked */
  blockReason?: string;
}

export interface PostToolUseHookInput {
  context: HookContext;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: unknown;
  durationMs: number;
}

export interface PostToolUseFailureHookInput {
  context: HookContext;
  toolName: string;
  toolInput: Record<string, unknown>;
  error: Error;
  attemptNumber: number;
}

export interface PostToolUseFailureHookResult {
  /** Whether to retry the operation */
  shouldRetry: boolean;
  /** Delay before retry in ms */
  retryDelayMs?: number;
  /** Alternative action to suggest */
  alternativeAction?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface OrchestratorConfig {
  /** Maximum concurrent agents */
  maxConcurrentAgents: number;
  /** Default working directory */
  defaultWorkingDirectory: string;
  /** Session storage path */
  sessionStoragePath: string;
  /** Default model to use */
  defaultModel: string;
  /** Global environment variables */
  globalEnv: Record<string, string>;
  /** Enable self-correction hooks */
  enableSelfCorrection: boolean;
  /** Enable audit logging */
  enableAuditLogging: boolean;
  /** Audit log path */
  auditLogPath?: string;
}

export const OrchestratorConfigSchema = z.object({
  maxConcurrentAgents: z.number().int().min(1).max(20).default(5),
  defaultWorkingDirectory: z.string().default(process.cwd()),
  sessionStoragePath: z.string().default('./.sessions'),
  defaultModel: z.string().default('claude-sonnet-4-20250514'),
  globalEnv: z.record(z.string(), z.string()).default({}),
  enableSelfCorrection: z.boolean().default(true),
  enableAuditLogging: z.boolean().default(true),
  auditLogPath: z.string().optional(),
});

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxConcurrentAgents: 5,
  defaultWorkingDirectory: process.cwd(),
  sessionStoragePath: './.sessions',
  defaultModel: 'claude-sonnet-4-20250514',
  globalEnv: {},
  enableSelfCorrection: true,
  enableAuditLogging: true,
};
