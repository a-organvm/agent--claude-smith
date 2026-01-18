import type { RetryConfig } from '../agents/types.js';

// ============================================================================
// Retry Handler with Exponential Backoff
// ============================================================================

/**
 * Error classification for retry decisions
 */
export type ErrorClassification =
  | 'transient'      // Temporary issues (rate limit, timeout, network)
  | 'recoverable'    // Can be fixed with different input/approach
  | 'permanent'      // Cannot be retried
  | 'unknown';

/**
 * Retry decision result
 */
export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
  classification: ErrorClassification;
}

/**
 * Retry statistics
 */
export interface RetryStats {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  retriedOperations: number;
  totalDelayMs: number;
}

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS: Record<ErrorClassification, RegExp[]> = {
  transient: [
    /rate.?limit/i,
    /429/,
    /too many requests/i,
    /timeout/i,
    /ETIMEDOUT/,
    /ECONNRESET/,
    /ECONNREFUSED/,
    /network.?error/i,
    /temporary/i,
    /unavailable/i,
    /503/,
    /502/,
    /504/,
    /overloaded/i,
  ],
  recoverable: [
    /ENOENT/,
    /not found/i,
    /EACCES/,
    /permission denied/i,
    /invalid.?input/i,
    /validation.?error/i,
    /missing.?parameter/i,
    /400/,
    /404/,
  ],
  permanent: [
    /authentication.?failed/i,
    /unauthorized/i,
    /forbidden/i,
    /401/,
    /403/,
    /invalid.?api.?key/i,
    /invalid.?token/i,
    /quota.?exceeded/i,
    /billing/i,
  ],
  unknown: [],
};

/**
 * Retry handler with configurable exponential backoff
 */
export class RetryHandler {
  private readonly config: RetryConfig;
  private readonly stats: RetryStats = {
    totalAttempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    retriedOperations: 0,
    totalDelayMs: 0,
  };

  constructor(config: RetryConfig) {
    this.config = config;
  }

  /**
   * Classify an error for retry decisions
   */
  classifyError(error: Error | string): ErrorClassification {
    const errorMessage = typeof error === 'string' ? error : error.message;

    for (const [classification, patterns] of Object.entries(ERROR_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(errorMessage)) {
          return classification as ErrorClassification;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Decide whether to retry based on error and attempt count
   */
  shouldRetry(error: Error | string, attemptNumber: number): RetryDecision {
    const classification = this.classifyError(error);
    const errorMessage = typeof error === 'string' ? error : error.message;

    // Check if we've exceeded max attempts
    if (attemptNumber >= this.config.maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: `Max attempts (${this.config.maxAttempts}) reached`,
        classification,
      };
    }

    // Check if error type is retryable
    if (classification === 'permanent') {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: `Permanent error: ${errorMessage}`,
        classification,
      };
    }

    // Check against configured retryable errors
    const isRetryable = this.config.retryableErrors.some(pattern =>
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );

    if (!isRetryable && classification !== 'transient') {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: `Error not in retryable list: ${errorMessage}`,
        classification,
      };
    }

    // Calculate delay with exponential backoff
    const delayMs = this.calculateDelay(attemptNumber);

    return {
      shouldRetry: true,
      delayMs,
      reason: `Retrying transient error (attempt ${attemptNumber + 1}/${this.config.maxAttempts})`,
      classification,
    };
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  calculateDelay(attemptNumber: number): number {
    // Base delay with exponential backoff
    const baseDelay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attemptNumber - 1);

    // Add jitter (±20%)
    const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);

    // Clamp to max delay
    const delay = Math.min(baseDelay + jitter, this.config.maxDelayMs);

    return Math.round(delay);
  }

  /**
   * Execute a function with automatic retry
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: {
      operationName?: string;
      onRetry?: (error: Error, attempt: number, delayMs: number) => void;
    } = {}
  ): Promise<T> {
    const { operationName = 'operation', onRetry } = options;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      this.stats.totalAttempts++;

      try {
        const result = await fn();
        this.stats.successfulAttempts++;
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.stats.failedAttempts++;

        const decision = this.shouldRetry(lastError, attempt);

        if (!decision.shouldRetry) {
          throw lastError;
        }

        // Log retry
        console.log(
          `[RetryHandler] ${operationName} failed (attempt ${attempt}/${this.config.maxAttempts}): ` +
          `${lastError.message}. Retrying in ${decision.delayMs}ms...`
        );

        // Call retry callback if provided
        if (onRetry) {
          onRetry(lastError, attempt, decision.delayMs);
        }

        // Wait before retry
        await this.sleep(decision.delayMs);
        this.stats.retriedOperations++;
        this.stats.totalDelayMs += decision.delayMs;
      }
    }

    // Should not reach here, but throw last error just in case
    throw lastError ?? new Error(`${operationName} failed after ${this.config.maxAttempts} attempts`);
  }

  /**
   * Get retry statistics
   */
  getStats(): Readonly<RetryStats> {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats.totalAttempts = 0;
    this.stats.successfulAttempts = 0;
    this.stats.failedAttempts = 0;
    this.stats.retriedOperations = 0;
    this.stats.totalDelayMs = 0;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a retry handler with default config
 */
export function createRetryHandler(config?: Partial<RetryConfig>): RetryHandler {
  const defaultConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR'],
  };

  return new RetryHandler({ ...defaultConfig, ...config });
}

/**
 * Simple retry wrapper for one-off operations
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<T> {
  const handler = createRetryHandler(config);
  return handler.executeWithRetry(fn);
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error | string): boolean {
  const handler = createRetryHandler();
  const classification = handler.classifyError(error);
  return classification === 'transient' || classification === 'unknown';
}
