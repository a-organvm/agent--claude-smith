import { z } from 'zod';
import { RetryConfigSchema, SecretReferenceSchema } from '../agents/types.js';

// ============================================================================
// chezmoi Data Types
// ============================================================================

/**
 * chezmoi data structure returned by `chezmoi data`
 */
export interface ChezmoiData {
  chezmoi: {
    arch: string;
    fqdnHostname: string;
    gid: string;
    group: string;
    homeDir: string;
    hostname: string;
    kernel: {
      osrelease: string;
      ostype: string;
      version: string;
    };
    os: string;
    osRelease?: {
      id: string;
      idLike?: string[];
      name: string;
      prettyName: string;
      versionId?: string;
    };
    sourceDir: string;
    uid: string;
    username: string;
    version: {
      builtBy: string;
      commit: string;
      date: string;
      version: string;
    };
    workingTree: string;
  };
  // Custom data from chezmoi config
  [key: string]: unknown;
}

// ============================================================================
// Agent Configuration (from TOML templates)
// ============================================================================

/**
 * Raw agent config structure from TOML file
 */
export interface RawAgentConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  systemPrompt: string;
  maxExecutionTimeMs?: number;
  maxTurns?: number;
  maxConcurrency?: number;
  model?: string;
  canSpawnSubagents?: boolean;
  allowedSubagents?: string[];

  // Nested sections
  tools?: RawToolConfig[];
  retry?: RawRetryConfig;
  secrets?: RawSecretConfig[];
}

export interface RawToolConfig {
  name: string;
  enabled: boolean;
  allowedPaths?: string[];
  blockedCommands?: string[];
}

export interface RawRetryConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

export interface RawSecretConfig {
  name: string;
  ref: string;
  required: boolean;
}

// Zod schemas for validation
export const RawToolConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  allowedPaths: z.array(z.string()).optional(),
  blockedCommands: z.array(z.string()).optional(),
});

export const RawAgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string(),
  capabilities: z.array(z.string()),
  systemPrompt: z.string().min(1),
  maxExecutionTimeMs: z.number().optional(),
  maxTurns: z.number().optional(),
  maxConcurrency: z.number().optional(),
  model: z.string().optional(),
  canSpawnSubagents: z.boolean().optional(),
  allowedSubagents: z.array(z.string()).optional(),
  tools: z.array(RawToolConfigSchema).optional(),
  retry: RetryConfigSchema.partial().optional(),
  secrets: z.array(SecretReferenceSchema).optional(),
});

// ============================================================================
// Environment Detection
// ============================================================================

export type Environment =
  | 'macos'
  | 'linux'
  | 'windows'
  | 'docker'
  | 'wsl'
  | 'unknown';

export interface EnvironmentInfo {
  environment: Environment;
  os: string;
  arch: string;
  hostname: string;
  username: string;
  homeDir: string;
  isDocker: boolean;
  isWsl: boolean;
  isCI: boolean;
}

// ============================================================================
// Config Manager Types
// ============================================================================

export interface LoadedAgentConfigs {
  /** Map of agent ID to parsed config */
  agents: Map<string, RawAgentConfig>;
  /** chezmoi data used for templating */
  chezmoiData: ChezmoiData | null;
  /** Environment info */
  environment: EnvironmentInfo;
  /** Errors encountered during loading */
  errors: ConfigLoadError[];
}

export interface ConfigLoadError {
  file: string;
  error: string;
  recoverable: boolean;
}

export interface ChezmoiManagerConfig {
  /** Path to agent config templates */
  templatesPath: string;
  /** Whether chezmoi is available */
  chezmoiAvailable?: boolean;
  /** Custom chezmoi data to merge */
  customData?: Record<string, unknown>;
  /** File extension for templates */
  templateExtension?: string;
}
