#!/usr/bin/env node
/**
 * Claude Agent Orchestrator
 *
 * Multi-agent orchestration system using the Claude Agent SDK with:
 * - Subagent spawning ("procreation") and parallel execution
 * - Long-running sessions with state persistence
 * - Self-correcting and self-healing patterns
 * - 1Password integration for secrets management
 * - chezmoi integration for configuration templates
 */

import { Orchestrator, getOrchestrator } from './core/orchestrator.js';
import { AgentRegistry, getAgentRegistry } from './core/agent-registry.js';
import { SessionManager, getSessionManager } from './core/session-manager.js';
import { ScopeValidator, getScopeValidator } from './core/scope-validator.js';
import { ChezmoiManager, createChezmoiManager } from './config/chezmoi-manager.js';
import { OnePasswordClient, getOnePasswordClient } from './secrets/one-password.js';
import { SecretResolver, getSecretResolver } from './secrets/secret-resolver.js';
import { BUILTIN_AGENTS, getBuiltinAgent, getBuiltinAgentIds } from './agents/index.js';
import type {
  OrchestratorConfig,
  AgentSpawnRequest,
  AgentResult,
  ExtendedAgentDefinition,
} from './agents/types.js';

// ============================================================================
// Re-exports for library usage
// ============================================================================

export {
  // Core
  Orchestrator,
  getOrchestrator,
  AgentRegistry,
  getAgentRegistry,
  SessionManager,
  getSessionManager,
  ScopeValidator,
  getScopeValidator,

  // Config
  ChezmoiManager,
  createChezmoiManager,

  // Secrets
  OnePasswordClient,
  getOnePasswordClient,
  SecretResolver,
  getSecretResolver,

  // Agents
  BUILTIN_AGENTS,
  getBuiltinAgent,
  getBuiltinAgentIds,
};

// Re-export types
export type {
  OrchestratorConfig,
  AgentSpawnRequest,
  AgentResult,
  ExtendedAgentDefinition,
};

export * from './agents/types.js';
export * from './config/types.js';
export * from './hooks/self-correction.js';
export * from './hooks/retry-handler.js';

// ============================================================================
// Factory Functions
// ============================================================================

export interface CreateOrchestratorOptions {
  /** Orchestrator configuration */
  config?: Partial<OrchestratorConfig>;
  /** Path to chezmoi agent config templates */
  templatesPath?: string;
  /** Whether to register built-in agents */
  registerBuiltins?: boolean;
  /** Custom agents to register */
  customAgents?: ExtendedAgentDefinition[];
  /** Callback for audit log entries */
  onAuditEntry?: (entry: unknown) => void;
}

/**
 * Create and initialize an orchestrator with full configuration
 */
export async function createOrchestrator(
  options: CreateOrchestratorOptions = {}
): Promise<Orchestrator> {
  const {
    config = {},
    templatesPath,
    registerBuiltins = true,
    customAgents = [],
    onAuditEntry,
  } = options;

  // Create chezmoi manager if templates path is provided
  const chezmoiManager = templatesPath
    ? createChezmoiManager(templatesPath)
    : undefined;

  // Create orchestrator
  const orchestrator = new Orchestrator({
    config,
    chezmoiManager,
    onAuditEntry,
  });

  // Initialize
  await orchestrator.initialize();

  // Register built-in agents
  if (registerBuiltins) {
    const registry = orchestrator.getRegistry();
    for (const agent of BUILTIN_AGENTS) {
      registry.register(agent);
    }
  }

  // Register custom agents
  if (customAgents.length > 0) {
    const registry = orchestrator.getRegistry();
    for (const agent of customAgents) {
      registry.register(agent);
    }
  }

  return orchestrator;
}

// ============================================================================
// CLI Interface
// ============================================================================

interface CLIOptions {
  agentId: string;
  prompt: string;
  workingDirectory?: string;
  sessionId?: string;
  parallel?: string[];
  list?: boolean;
  resume?: string;
  cleanup?: boolean;
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    agentId: '',
    prompt: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--agent':
      case '-a':
        options.agentId = args[++i] ?? '';
        break;
      case '--prompt':
      case '-p':
        options.prompt = args[++i] ?? '';
        break;
      case '--cwd':
      case '-d':
        options.workingDirectory = args[++i];
        break;
      case '--session':
      case '-s':
        options.sessionId = args[++i];
        break;
      case '--parallel':
        options.parallel = args[++i]?.split(',');
        break;
      case '--list':
      case '-l':
        options.list = true;
        break;
      case '--resume':
      case '-r':
        options.resume = args[++i];
        break;
      case '--cleanup':
        options.cleanup = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Claude Agent Orchestrator

Usage:
  claude-agent [options]

Options:
  -a, --agent <id>      Agent ID to spawn
  -p, --prompt <text>   Prompt/task for the agent
  -d, --cwd <path>      Working directory (default: current)
  -s, --session <id>    Session ID for resumption
  --parallel <ids>      Comma-separated agent IDs to run in parallel
  -l, --list            List available agents
  -r, --resume <id>     Resume a paused session
  --cleanup             Clean up old completed sessions
  -h, --help            Show this help

Examples:
  # Run a code review
  claude-agent -a code-reviewer -p "Review src/auth/ for security issues"

  # Run multiple agents in parallel
  claude-agent --parallel code-reviewer,security-auditor -p "Analyze the codebase"

  # Resume a paused session
  claude-agent --resume <session-id>

  # List available agents
  claude-agent --list

Environment Variables:
  ANTHROPIC_API_KEY         Claude API key (or use 1Password)
  OP_SERVICE_ACCOUNT_TOKEN  1Password service account token
  CLAUDE_AGENT_TEMPLATES    Path to agent config templates
`);
}

async function listAgents(orchestrator: Orchestrator): Promise<void> {
  const agents = orchestrator.getRegistry().getAll();

  console.log('\nAvailable Agents:\n');

  for (const agent of agents) {
    console.log(`  ${agent.id}`);
    console.log(`    Name: ${agent.name}`);
    console.log(`    Category: ${agent.category}`);
    console.log(`    Description: ${agent.description}`);
    console.log(`    Capabilities: ${agent.capabilities.join(', ')}`);
    console.log(`    Can spawn: ${agent.canSpawnSubagents ? 'yes' : 'no'}`);
    console.log();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Create orchestrator
  const orchestrator = await createOrchestrator({
    templatesPath: process.env.CLAUDE_AGENT_TEMPLATES,
    registerBuiltins: true,
  });

  // Handle shutdown gracefully
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await orchestrator.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await orchestrator.shutdown();
    process.exit(0);
  });

  try {
    // List agents
    if (options.list) {
      await listAgents(orchestrator);
      await orchestrator.shutdown();
      return;
    }

    // Cleanup old sessions
    if (options.cleanup) {
      const count = await orchestrator.getSessionManager().cleanup();
      console.log(`Cleaned up ${count} old sessions`);
      await orchestrator.shutdown();
      return;
    }

    // Resume a session
    if (options.resume) {
      console.log(`Resuming session ${options.resume}...`);
      const result = await orchestrator.resumeSession(options.resume);

      if (!result) {
        console.error('Session not found or cannot be resumed');
        process.exit(1);
      }

      console.log('\nResult:', result.status);
      if (result.result) {
        console.log('\nOutput:\n', result.result);
      }
      if (result.error) {
        console.error('\nError:', result.error);
      }

      await orchestrator.shutdown();
      return;
    }

    // Parallel execution
    if (options.parallel && options.prompt) {
      const requests: AgentSpawnRequest[] = options.parallel.map(agentId => ({
        agentId,
        prompt: options.prompt,
        workingDirectory: options.workingDirectory,
      }));

      console.log(`Running ${requests.length} agents in parallel...`);
      const results = await orchestrator.spawnParallel(requests);

      console.log('\nResults:');
      for (const result of results) {
        console.log(`\n--- ${result.agentId} (${result.status}) ---`);
        if (result.result) {
          console.log(result.result.substring(0, 500) + (result.result.length > 500 ? '...' : ''));
        }
        if (result.error) {
          console.error('Error:', result.error);
        }
      }

      await orchestrator.shutdown();
      return;
    }

    // Single agent execution
    if (options.agentId && options.prompt) {
      console.log(`Spawning agent ${options.agentId}...`);

      const result = await orchestrator.spawnAgent({
        agentId: options.agentId,
        prompt: options.prompt,
        workingDirectory: options.workingDirectory,
        sessionId: options.sessionId,
      });

      console.log('\nResult:', result.status);
      console.log('Session ID:', result.sessionId);
      console.log('Turns taken:', result.turnsTaken);
      console.log('Execution time:', result.executionTimeMs, 'ms');

      if (result.result) {
        console.log('\nOutput:\n', result.result);
      }
      if (result.error) {
        console.error('\nError:', result.error);
      }

      await orchestrator.shutdown();
      return;
    }

    // No valid options
    printHelp();
    await orchestrator.shutdown();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    await orchestrator.shutdown();
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}
