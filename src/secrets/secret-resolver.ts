import type { SecretReference, ExtendedAgentDefinition } from '../agents/types.js';
import { OnePasswordClient, getOnePasswordClient } from './one-password.js';

// ============================================================================
// Secret Resolver
// ============================================================================

interface ResolvedSecrets {
  /** Map of secret name to resolved value */
  secrets: Map<string, string>;
  /** Environment variables with secrets injected */
  env: Record<string, string>;
  /** List of secrets that failed to resolve (optional ones) */
  unresolvedOptional: string[];
}

interface SecretResolverConfig {
  /** 1Password client instance */
  opClient?: OnePasswordClient;
  /** Base environment variables to merge with */
  baseEnv?: Record<string, string>;
  /** Whether to mask secrets in logs */
  maskInLogs?: boolean;
}

/**
 * High-level secret resolution for agents
 */
export class SecretResolver {
  private readonly opClient: OnePasswordClient;
  private readonly baseEnv: Record<string, string>;

  constructor(config: SecretResolverConfig = {}) {
    this.opClient = config.opClient ?? getOnePasswordClient();
    this.baseEnv = config.baseEnv ?? {};
  }

  /**
   * Resolve all secrets for an agent definition
   */
  async resolveForAgent(agent: ExtendedAgentDefinition): Promise<ResolvedSecrets> {
    return this.resolveSecrets(agent.secretRefs);
  }

  /**
   * Resolve a list of secret references
   */
  async resolveSecrets(refs: SecretReference[]): Promise<ResolvedSecrets> {
    const secrets = new Map<string, string>();
    const unresolvedOptional: string[] = [];

    if (!this.opClient.isConfigured()) {
      // When 1Password is not configured, check environment variables as fallback
      console.warn('[SecretResolver] 1Password not configured, falling back to environment variables');
      return this.resolveFromEnvironment(refs);
    }

    // Separate required and optional secrets
    const required = refs.filter(r => r.required);
    const optional = refs.filter(r => !r.required);

    // Resolve required secrets (will throw if any fail)
    if (required.length > 0) {
      const resolvedRequired = await this.opClient.resolveSecrets(required);
      for (const [name, value] of resolvedRequired) {
        secrets.set(name, value);
      }
    }

    // Resolve optional secrets (won't throw, just log warnings)
    for (const secretRef of optional) {
      try {
        const value = await this.opClient.getSecret(secretRef.ref);
        secrets.set(secretRef.name, value);
      } catch {
        unresolvedOptional.push(secretRef.name);
        // Check environment variable as fallback for optional secrets
        const envValue = process.env[secretRef.name];
        if (envValue) {
          secrets.set(secretRef.name, envValue);
          this.log(`Using environment variable fallback for optional secret '${secretRef.name}'`);
        }
      }
    }

    // Build environment with secrets
    const env = this.buildEnvWithSecrets(secrets);

    return { secrets, env, unresolvedOptional };
  }

  /**
   * Fallback resolution from environment variables
   */
  private resolveFromEnvironment(refs: SecretReference[]): ResolvedSecrets {
    const secrets = new Map<string, string>();
    const unresolvedOptional: string[] = [];
    const missingRequired: string[] = [];

    for (const ref of refs) {
      const value = process.env[ref.name];
      if (value) {
        secrets.set(ref.name, value);
      } else if (ref.required) {
        missingRequired.push(ref.name);
      } else {
        unresolvedOptional.push(ref.name);
      }
    }

    if (missingRequired.length > 0) {
      throw new Error(`Missing required secrets (not found in environment): ${missingRequired.join(', ')}`);
    }

    const env = this.buildEnvWithSecrets(secrets);

    return { secrets, env, unresolvedOptional };
  }

  /**
   * Build environment object with secrets merged in
   */
  private buildEnvWithSecrets(secrets: Map<string, string>): Record<string, string> {
    const env: Record<string, string> = { ...this.baseEnv };

    for (const [name, value] of secrets) {
      env[name] = value;
    }

    return env;
  }

  /**
   * Mask a secret value for safe logging
   */
  maskSecret(value: string): string {
    if (value.length <= 8) {
      return '****';
    }
    return value.substring(0, 4) + '****' + value.substring(value.length - 4);
  }

  /**
   * Check if a string contains any known secrets
   */
  containsSecrets(text: string, secrets: Map<string, string>): boolean {
    for (const value of secrets.values()) {
      if (text.includes(value)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Redact secrets from a string
   */
  redactSecrets(text: string, secrets: Map<string, string>): string {
    let result = text;
    for (const [name, value] of secrets) {
      result = result.replaceAll(value, `[REDACTED:${name}]`);
    }
    return result;
  }

  /**
   * Log with optional masking
   */
  private log(message: string): void {
    console.log(`[SecretResolver] ${message}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a string looks like a 1Password reference
 */
export function isOnePasswordRef(value: string): boolean {
  return value.startsWith('op://');
}

/**
 * Validate a 1Password reference format
 */
export function validateOnePasswordRef(ref: string): { valid: boolean; error?: string } {
  const pattern = /^op:\/\/[^/]+\/[^/]+\/[^/]+$/;
  if (!pattern.test(ref)) {
    return {
      valid: false,
      error: `Invalid 1Password reference format: ${ref}. Expected: op://<vault>/<item>/<field>`,
    };
  }
  return { valid: true };
}

/**
 * Create a secret reference object
 */
export function createSecretRef(
  name: string,
  ref: string,
  required: boolean = true
): SecretReference {
  const validation = validateOnePasswordRef(ref);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  return { name, ref, required };
}

// Default resolver instance
let defaultResolver: SecretResolver | null = null;

/**
 * Get the default secret resolver instance
 */
export function getSecretResolver(config?: SecretResolverConfig): SecretResolver {
  if (!defaultResolver) {
    defaultResolver = new SecretResolver(config);
  }
  return defaultResolver;
}

/**
 * Reset the default resolver (useful for testing)
 */
export function resetSecretResolver(): void {
  defaultResolver = null;
}
