/**
 * OnePassword Client Unit Tests
 *
 * Tests for 1Password SDK wrapper with caching support.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SecretReference } from '../../../src/agents/types.js';

// Mock resolve function that we can control in tests
const mockResolve = vi.fn();

// Mock the 1Password SDK using factory function
vi.mock('@1password/sdk', () => ({
  createClient: vi.fn().mockImplementation(() =>
    Promise.resolve({
      secrets: {
        resolve: mockResolve,
      },
    })
  ),
}));

// Import after mocking
import {
  OnePasswordClient,
  getOnePasswordClient,
  resetOnePasswordClient,
} from '../../../src/secrets/one-password.js';
import { createClient } from '@1password/sdk';

describe('OnePasswordClient', () => {
  const validToken = 'test-service-account-token';
  const originalEnv = process.env.OP_SERVICE_ACCOUNT_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    resetOnePasswordClient();
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.OP_SERVICE_ACCOUNT_TOKEN = originalEnv;
    }
  });

  describe('constructor', () => {
    it('should create client with provided token', () => {
      const client = new OnePasswordClient({ serviceAccountToken: validToken });
      expect(client.isConfigured()).toBe(true);
    });

    it('should use environment variable if no token provided', () => {
      process.env.OP_SERVICE_ACCOUNT_TOKEN = 'env-token';
      const client = new OnePasswordClient();
      expect(client.isConfigured()).toBe(true);
    });

    it('should warn if no token is configured', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = new OnePasswordClient();
      expect(client.isConfigured()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No service account token'));
      warnSpy.mockRestore();
    });

    it('should accept custom cache TTL', () => {
      const client = new OnePasswordClient({
        serviceAccountToken: validToken,
        cacheTtlMs: 60000,
      });
      expect(client.isConfigured()).toBe(true);
    });

    it('should accept custom integration info', () => {
      const client = new OnePasswordClient({
        serviceAccountToken: validToken,
        integrationName: 'custom-app',
        integrationVersion: '2.0.0',
      });
      expect(client.isConfigured()).toBe(true);
    });
  });

  describe('getSecret', () => {
    it('should fetch and cache secret', async () => {
      mockResolve.mockResolvedValue('secret-value');

      const client = new OnePasswordClient({ serviceAccountToken: validToken });
      const value = await client.getSecret('op://vault/item/field');

      expect(value).toBe('secret-value');
      expect(createClient).toHaveBeenCalledWith({
        auth: validToken,
        integrationName: 'claude-agent-orchestrator',
        integrationVersion: '1.0.0',
      });
      expect(mockResolve).toHaveBeenCalledWith('op://vault/item/field');
    });

    it('should return cached value on subsequent calls', async () => {
      mockResolve.mockResolvedValue('secret-value');

      const client = new OnePasswordClient({ serviceAccountToken: validToken });

      // First call
      await client.getSecret('op://vault/item/field');
      // Second call (should use cache)
      const value = await client.getSecret('op://vault/item/field');

      expect(value).toBe('secret-value');
      expect(mockResolve).toHaveBeenCalledTimes(1);
    });

    it('should refetch after cache expires', async () => {
      vi.useFakeTimers();
      mockResolve.mockResolvedValue('secret-value');

      // Very short cache TTL for testing
      const client = new OnePasswordClient({
        serviceAccountToken: validToken,
        cacheTtlMs: 100,
      });

      // First call
      await client.getSecret('op://vault/item/field');

      // Advance past TTL
      vi.advanceTimersByTime(200);

      // Second call should refetch
      await client.getSecret('op://vault/item/field');

      expect(mockResolve).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should throw for invalid reference format', async () => {
      const client = new OnePasswordClient({ serviceAccountToken: validToken });

      await expect(client.getSecret('invalid-ref')).rejects.toThrow('Invalid 1Password reference format');
      await expect(client.getSecret('op://only-two-parts/item')).rejects.toThrow('Invalid 1Password reference format');
      await expect(client.getSecret('not-op://vault/item/field')).rejects.toThrow('Invalid 1Password reference format');
    });

    it('should throw if not configured', async () => {
      const client = new OnePasswordClient();

      await expect(client.getSecret('op://vault/item/field')).rejects.toThrow('1Password service account token not configured');
    });

    it('should throw with details on API error', async () => {
      mockResolve.mockRejectedValue(new Error('API Error'));

      const client = new OnePasswordClient({ serviceAccountToken: validToken });

      await expect(client.getSecret('op://vault/item/field')).rejects.toThrow('Failed to resolve secret');
    });

    it('should initialize client only once', async () => {
      mockResolve.mockResolvedValue('value');

      const client = new OnePasswordClient({ serviceAccountToken: validToken });

      // Make multiple concurrent calls
      await Promise.all([
        client.getSecret('op://vault/item/field1'),
        client.getSecret('op://vault/item/field2'),
        client.getSecret('op://vault/item/field3'),
      ]);

      // createClient should only be called once
      expect(createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveSecrets', () => {
    it('should resolve multiple secrets', async () => {
      mockResolve
        .mockResolvedValueOnce('api-key-value')
        .mockResolvedValueOnce('db-password-value');

      const client = new OnePasswordClient({ serviceAccountToken: validToken });
      const refs: SecretReference[] = [
        { name: 'API_KEY', ref: 'op://vault/item/api-key', required: true },
        { name: 'DB_PASSWORD', ref: 'op://vault/item/password', required: true },
      ];

      const results = await client.resolveSecrets(refs);

      expect(results.get('API_KEY')).toBe('api-key-value');
      expect(results.get('DB_PASSWORD')).toBe('db-password-value');
    });

    it('should throw if required secret fails', async () => {
      mockResolve.mockRejectedValue(new Error('Not found'));

      const client = new OnePasswordClient({ serviceAccountToken: validToken });
      const refs: SecretReference[] = [
        { name: 'REQUIRED_SECRET', ref: 'op://vault/item/field', required: true },
      ];

      await expect(client.resolveSecrets(refs)).rejects.toThrow('Failed to resolve required secrets');
    });

    it('should log warning for optional secret failure', async () => {
      mockResolve.mockRejectedValue(new Error('Not found'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const client = new OnePasswordClient({ serviceAccountToken: validToken });
      const refs: SecretReference[] = [
        { name: 'OPTIONAL_SECRET', ref: 'op://vault/item/field', required: false },
      ];

      const results = await client.resolveSecrets(refs);

      expect(results.size).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Optional secret'));
      warnSpy.mockRestore();
    });

    it('should handle mix of successful and failed optional secrets', async () => {
      mockResolve
        .mockResolvedValueOnce('success-value')
        .mockRejectedValueOnce(new Error('Not found'));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const client = new OnePasswordClient({ serviceAccountToken: validToken });
      const refs: SecretReference[] = [
        { name: 'SUCCESS', ref: 'op://vault/item/field1', required: false },
        { name: 'FAIL', ref: 'op://vault/item/field2', required: false },
      ];

      const results = await client.resolveSecrets(refs);

      expect(results.size).toBe(1);
      expect(results.get('SUCCESS')).toBe('success-value');
      expect(results.has('FAIL')).toBe(false);

      warnSpy.mockRestore();
    });
  });

  describe('cache management', () => {
    it('should clear entire cache', async () => {
      mockResolve.mockResolvedValue('value');

      const client = new OnePasswordClient({ serviceAccountToken: validToken });

      // Populate cache
      await client.getSecret('op://vault/item/field');
      expect(mockResolve).toHaveBeenCalledTimes(1);

      // Clear cache
      client.clearCache();

      // Next call should fetch again
      await client.getSecret('op://vault/item/field');
      expect(mockResolve).toHaveBeenCalledTimes(2);
    });

    it('should prune expired entries', async () => {
      vi.useFakeTimers();
      mockResolve.mockResolvedValue('value');

      const client = new OnePasswordClient({
        serviceAccountToken: validToken,
        cacheTtlMs: 100,
      });

      // Populate cache
      await client.getSecret('op://vault/item/field1');

      // Advance partially
      vi.advanceTimersByTime(50);

      // Add another entry
      await client.getSecret('op://vault/item/field2');

      // Advance past first entry's TTL
      vi.advanceTimersByTime(60);

      // Prune expired
      client.pruneCache();

      // First entry should need refetch, second should still be cached
      mockResolve.mockClear();

      await client.getSecret('op://vault/item/field1');
      await client.getSecret('op://vault/item/field2');

      // Only field1 should trigger a new API call
      expect(mockResolve).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('isConfigured', () => {
    it('should return true when token is provided', () => {
      const client = new OnePasswordClient({ serviceAccountToken: validToken });
      expect(client.isConfigured()).toBe(true);
    });

    it('should return false when no token', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = new OnePasswordClient();
      expect(client.isConfigured()).toBe(false);
      warnSpy.mockRestore();
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetOnePasswordClient();
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
  });

  describe('getOnePasswordClient', () => {
    it('should return singleton instance', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const client1 = getOnePasswordClient();
      const client2 = getOnePasswordClient();

      expect(client1).toBe(client2);
      warnSpy.mockRestore();
    });

    it('should use provided config on first call', () => {
      const client = getOnePasswordClient({
        serviceAccountToken: 'custom-token',
      });

      expect(client.isConfigured()).toBe(true);
    });
  });

  describe('resetOnePasswordClient', () => {
    it('should reset singleton', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const client1 = getOnePasswordClient();
      resetOnePasswordClient();
      const client2 = getOnePasswordClient();

      expect(client1).not.toBe(client2);
      warnSpy.mockRestore();
    });
  });
});
