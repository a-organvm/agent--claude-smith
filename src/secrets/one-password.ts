import { createClient, Client } from '@1password/sdk';
import type { SecretReference } from '../agents/types.js';

// ============================================================================
// 1Password Client Wrapper
// ============================================================================

interface CachedSecret {
  value: string;
  expiresAt: number;
}

interface OnePasswordConfig {
  /** Service account token (from OP_SERVICE_ACCOUNT_TOKEN env var) */
  serviceAccountToken?: string;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs?: number;
  /** Integration name for 1Password */
  integrationName?: string;
  /** Integration version */
  integrationVersion?: string;
}

/**
 * 1Password SDK wrapper with caching support
 */
export class OnePasswordClient {
  private client: Client | null = null;
  private cache: Map<string, CachedSecret> = new Map();
  private readonly cacheTtlMs: number;
  private readonly serviceAccountToken: string;
  private readonly integrationName: string;
  private readonly integrationVersion: string;
  private initPromise: Promise<void> | null = null;

  constructor(config: OnePasswordConfig = {}) {
    this.serviceAccountToken = config.serviceAccountToken ?? process.env.OP_SERVICE_ACCOUNT_TOKEN ?? '';
    this.cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1000; // 5 minutes default
    this.integrationName = config.integrationName ?? 'claude-agent-orchestrator';
    this.integrationVersion = config.integrationVersion ?? '1.0.0';

    if (!this.serviceAccountToken) {
      console.warn('[1Password] No service account token provided. Secret resolution will fail.');
    }
  }

  /**
   * Initialize the 1Password client
   */
  private async initialize(): Promise<void> {
    if (this.client) return;

    if (!this.serviceAccountToken) {
      throw new Error('1Password service account token not configured. Set OP_SERVICE_ACCOUNT_TOKEN environment variable.');
    }

    this.client = await createClient({
      auth: this.serviceAccountToken,
      integrationName: this.integrationName,
      integrationVersion: this.integrationVersion,
    });
  }

  /**
   * Ensure client is initialized (singleton pattern)
   */
  private async ensureInitialized(): Promise<Client> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;

    if (!this.client) {
      throw new Error('1Password client failed to initialize');
    }

    return this.client;
  }

  /**
   * Parse a 1Password reference URI
   * Format: op://<vault>/<item>/<field>
   */
  private parseReference(ref: string): { vault: string; item: string; field: string } {
    const match = ref.match(/^op:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (!match) {
      throw new Error(`Invalid 1Password reference format: ${ref}. Expected: op://<vault>/<item>/<field>`);
    }
    return {
      vault: match[1],
      item: match[2],
      field: match[3],
    };
  }

  /**
   * Get a secret value, using cache if available
   */
  async getSecret(ref: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(ref);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Validate the reference format first
    this.parseReference(ref);

    // Fetch from 1Password
    const client = await this.ensureInitialized();

    try {
      // Use the secrets.resolve method with the secret reference
      const value = await client.secrets.resolve(ref);

      // Cache the result
      this.cache.set(ref, {
        value,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      return value;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to resolve secret ${ref}: ${errorMessage}`);
    }
  }

  /**
   * Resolve multiple secrets in bulk (for efficiency)
   */
  async resolveSecrets(refs: SecretReference[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const errors: string[] = [];

    // Process all secrets concurrently
    const promises = refs.map(async (secretRef) => {
      try {
        const value = await this.getSecret(secretRef.ref);
        results.set(secretRef.name, value);
      } catch (error) {
        if (secretRef.required) {
          errors.push(`Required secret '${secretRef.name}': ${error instanceof Error ? error.message : String(error)}`);
        } else {
          console.warn(`[1Password] Optional secret '${secretRef.name}' not resolved: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });

    await Promise.all(promises);

    if (errors.length > 0) {
      throw new Error(`Failed to resolve required secrets:\n${errors.join('\n')}`);
    }

    return results;
  }

  /**
   * Clear the secret cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear expired entries from cache
   */
  pruneCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Check if the client is properly configured
   */
  isConfigured(): boolean {
    return !!this.serviceAccountToken;
  }
}

// Singleton instance for convenience
let defaultClient: OnePasswordClient | null = null;

/**
 * Get the default 1Password client instance
 */
export function getOnePasswordClient(config?: OnePasswordConfig): OnePasswordClient {
  if (!defaultClient) {
    defaultClient = new OnePasswordClient(config);
  }
  return defaultClient;
}

/**
 * Reset the default client (useful for testing)
 */
export function resetOnePasswordClient(): void {
  defaultClient = null;
}
