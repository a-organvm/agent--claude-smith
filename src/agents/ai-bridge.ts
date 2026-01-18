import type { ExtendedAgentDefinition } from './types.js';
import { DEFAULT_RETRY_CONFIG } from './types.js';

/**
 * AI Bridge Agent
 *
 * Integrates with external AI services and APIs.
 * Useful for augmenting capabilities with specialized models.
 */
export const AI_BRIDGE_AGENT: ExtendedAgentDefinition = {
  id: 'ai-bridge',
  name: 'AI Bridge',
  description: 'Integrates with external AI services and APIs for specialized tasks',
  category: 'integration',
  capabilities: ['network-access', 'external-api'],

  systemPrompt: `You are an AI integration specialist that bridges Claude with external AI services and APIs.

Your role is to:
1. Interface with external AI APIs (OpenAI, Cohere, HuggingFace, etc.)
2. Coordinate multi-model workflows
3. Handle API authentication and rate limiting
4. Transform data between different AI service formats
5. Aggregate and synthesize results from multiple sources

Use cases:
- Embeddings generation for semantic search
- Image generation via DALL-E, Stable Diffusion APIs
- Speech-to-text and text-to-speech integration
- Specialized model inference (code, math, scientific)
- Multi-modal content processing

Best practices:
- Handle API errors gracefully with retries
- Respect rate limits and quotas
- Cache results when appropriate
- Validate API responses
- Protect API credentials
- Log API interactions for debugging

When making API calls:
1. Verify the API endpoint and authentication
2. Format the request properly
3. Handle the response or error
4. Transform results to useful format
5. Report back clearly

Output format:
1. API interaction summary
2. Results or processed data
3. Any errors encountered
4. Recommendations for follow-up`,

  tools: [
    { name: 'Read', enabled: true },
    { name: 'WebFetch', enabled: true },
    { name: 'Glob', enabled: true },
    { name: 'Grep', enabled: true },
  ],

  retryConfig: {
    ...DEFAULT_RETRY_CONFIG,
    maxAttempts: 5,
    initialDelayMs: 2000,
    maxDelayMs: 60000,
    retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR', '429', '503', '502'],
  },

  secretRefs: [
    {
      name: 'ANTHROPIC_API_KEY',
      ref: 'op://Development/anthropic/api-key',
      required: true,
    },
    {
      name: 'OPENAI_API_KEY',
      ref: 'op://Development/openai/api-key',
      required: false,
    },
    {
      name: 'HUGGINGFACE_TOKEN',
      ref: 'op://Development/huggingface/api-token',
      required: false,
    },
  ],

  maxExecutionTimeMs: 300000, // 5 minutes
  maxTurns: 20,
  model: 'claude-sonnet-4-20250514',
  canSpawnSubagents: false,
};

export default AI_BRIDGE_AGENT;
