# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-agent orchestration system built with the Claude Agent SDK. Provides subagent spawning, parallel execution, session persistence, self-correction with automatic retry, 1Password secrets management, and chezmoi configuration templates.

## Development Commands

```bash
# Type check (run before committing)
npm run typecheck

# Build
npm run build

# Run tests
npm test                           # Run all tests
npm run test:watch                 # Watch mode
npm run test:coverage              # With coverage report
npm run test:security              # Security tests only
npx vitest run tests/unit/core     # Run tests in specific directory
npx vitest run -t "spawnAgent"     # Run tests matching pattern

# Development
npm run dev                        # Watch mode with tsx
npm start                          # Run directly
```

## Architecture

### Core Flow

`Orchestrator` is the main entry point. It coordinates:
- `AgentRegistry` - stores agent definitions by ID
- `SessionManager` / `SessionStore` - persists session state to disk
- `SecretResolver` - resolves `op://` references via 1Password
- `SelfCorrectionHooks` - validates tool calls, blocks dangerous operations, tracks failures

When `spawnAgent()` is called:
1. Look up agent definition in registry
2. Resolve secrets via SecretResolver
3. Create/resume session via SessionManager
4. Execute via Anthropic API
5. Track via hooks for safety and audit logging

### Singleton Pattern

All core services use a factory pattern with explicit reset functions for testing:

```typescript
// Factory with default singleton
export function getOrchestrator(options?: Options): Orchestrator {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new Orchestrator(options);
  }
  return defaultOrchestrator;
}

// Reset for testing
export function resetOrchestrator(): void {
  defaultOrchestrator = null;
}
```

This pattern appears in: `orchestrator.ts`, `agent-registry.ts`, `session-manager.ts`, `secret-resolver.ts`, `self-correction.ts`, `session-store.ts`.

**Important for tests**: Call all `reset*()` functions in `beforeEach` to ensure test isolation.

### Security Layer

`src/security/command-validator.ts` provides:
- `validateCommand(cmd)` - blocks dangerous shell commands (rm -rf, sudo, fork bombs, reverse shells, etc.)
- `validateWritePath(path)` - blocks writes to sensitive paths (/etc, ~/.ssh, shell rc files)
- `validateSessionId(id)` - prevents path traversal in session IDs

The `SelfCorrectionHooks` class uses these validators in `preToolUse()` hooks.

### Session State

Sessions are stored as JSON files in `.sessions/` directory. The `SessionStore` handles:
- File I/O with `KeyedMutex` for concurrent access safety
- Atomic writes (write to temp, then rename)
- Path traversal prevention via session ID validation

### Type System

All types are defined in `src/agents/types.ts` with Zod schemas for runtime validation:
- `ExtendedAgentDefinition` / `ExtendedAgentDefinitionSchema`
- `AgentSpawnRequest` / `AgentSpawnRequestSchema`
- `SessionState`, `RetryConfig`, `HookContext`, etc.

## Key Implementation Details

### Parallel Execution

`spawnParallel()` maintains result order matching input request order, regardless of completion order. Uses pre-allocated result array with index tracking.

### Bounded Memory

- `CircularBuffer` for audit log (O(1) insertion, fixed size)
- `ExpiringMap` for failure tracking (entries expire after 5 min TTL)

### 1Password References

Secrets use format `op://<vault>/<item>/<field>`:
```typescript
secretRefs: [
  { name: 'ANTHROPIC_API_KEY', ref: 'op://Development/anthropic/api-key', required: true }
]
```

## Environment Variables

- `ANTHROPIC_API_KEY` - Claude API key
- `OP_SERVICE_ACCOUNT_TOKEN` - 1Password service account token
- `CLAUDE_AGENT_TEMPLATES` - Path to chezmoi agent config templates

## Test Structure

```
tests/
├── setup.ts                    # Global test setup
├── helpers/mock-anthropic.ts   # Mock Anthropic SDK
├── unit/                       # Unit tests mirror src/ structure
└── security/                   # Security-focused tests
```

Vitest globals are enabled (`describe`, `it`, `expect`, `vi` available without imports).

<!-- ORGANVM:AUTO:START -->
## System Context (auto-generated — do not edit)

**Organ:** ORGAN-IV (Orchestration) | **Tier:** standard | **Status:** GRADUATED
**Org:** `organvm-iv-taxis` | **Repo:** `agent--claude-smith`

### Edges
- **Produces** → `organvm-iv-taxis/a-i--skills`: governance-policy
- **Consumes** ← `META-ORGANVM`: registry

### Siblings in Orchestration
`orchestration-start-here`, `petasum-super-petasum`, `universal-node-network`, `.github`, `agentic-titan`, `a-i--skills`, `tool-interaction-design`, `system-governance-framework`, `reverse-engine-recursive-run`, `collective-persona-operations`, `contrib--adenhq-hive`, `contrib--ipqwery-ipapi-py`, `contrib--primeinc-github-stars`, `contrib--temporal-sdk-python`, `contrib--dbt-mcp` ... and 6 more

### Governance
- *Standard ORGANVM governance applies*

*Last synced: 2026-05-23T00:26:31Z*

## Active Handoff Protocol

If `.conductor/active-handoff.md` exists, **READ IT FIRST** before doing any work.
It contains constraints, locked files, conventions, and completed work from the
originating agent. You MUST honor all constraints listed there.

If the handoff says "CROSS-VERIFICATION REQUIRED", your self-assessment will
NOT be trusted. A different agent will verify your output against these constraints.

## Session Review Protocol

At the end of each session that produces or modifies files:
1. Run `organvm session review --latest` to get a session summary
2. Check for unimplemented plans: `organvm session plans --project .`
3. Export significant sessions: `organvm session export <id> --slug <slug>`
4. Run `organvm prompts distill --dry-run` to detect uncovered operational patterns

Transcripts are on-demand (never committed):
- `organvm session transcript <id>` — conversation summary
- `organvm session transcript <id> --unabridged` — full audit trail
- `organvm session prompts <id>` — human prompts only


## System Library

Plans: 269 indexed | Chains: 5 available | SOPs: 8 active
Discover: `organvm plans search <query>` | `organvm chains list` | `organvm sop lifecycle`
Library: `/Users/4jp/Code/organvm/praxis-perpetua/library`


## Active Directives

| Scope | Phase | Name | Description |
|-------|-------|------|-------------|
| system | any | atomic-clock | The Atomic Clock |
| system | any | execution-sequence | Execution Sequence |
| system | any | multi-agent-dispatch | Multi-Agent Dispatch |
| system | any | session-handoff-avalanche | Session Handoff Avalanche |
| system | any | system-loops | System Loops |
| system | any | prompting-standards | Prompting Standards |
| system | any | background-task-resilience | background-task-resilience |
| system | any | context-window-conservation | context-window-conservation |
| system | any | session-self-critique | session-self-critique |
| system | any | the-descent-protocol | the-descent-protocol |
| system | any | the-membrane-protocol | the-membrane-protocol |
| system | any | theory-to-concrete-gate | theory-to-concrete-gate |
| system | any | triangulation-protocol | triangulation-protocol |

Linked skills: SOP-TRIADIC-REVIEW-PROTOCOL, cicd-resilience-and-recovery, continuous-learning-agent, evaluation-to-growth, genesis-dna, multi-agent-workforce-planner, promotion-and-state-transitions, quality-gate-baseline-calibration, repo-onboarding-and-habitat-creation, session-self-critique, structural-integrity-audit, the-membrane-protocol, triple-reference


**Prompting (Anthropic)**: context 200K tokens, format: XML tags, thinking: extended thinking (budget_tokens)


## Atomization Pipeline

Run `organvm atoms pipeline --write && organvm atoms fanout --write` to generate task queue.


## System Density (auto-generated)

AMMOI: 25% | Edges: 0 | Tensions: 0 | Clusters: 0 | Adv: 27 | Events(24h): 37975
Structure: 8 organs / 148 repos / 1654 components (depth 17) | Inference: 0% | Organs: META-ORGANVM:63%, ORGAN-I:53%, ORGAN-II:48%, ORGAN-III:54% +5 more
Last pulse: 2026-05-23T00:26:28 | Δ24h: n/a | Δ7d: n/a


## Dialect Identity (Trivium)

**Dialect:** GOVERNANCE_LOGIC | **Classical Parallel:** Rhetoric | **Translation Role:** The Meta-Logic — governance rules ARE propositions

Strongest translations: I (formal), V (structural), META (structural)

Scan: `organvm trivium scan IV <OTHER>` | Matrix: `organvm trivium matrix` | Synthesize: `organvm trivium synthesize`


## Logos Documentation Layer

**Status:** ACTIVE | **Symmetry:** 0.5 (DREAM)

Nature demands a documentation counterpart. This formation maintains its narrative record in `docs/logos/`.

### The Tetradic Counterpart
- **[Telos (Idealized Form)](../docs/logos/telos.md)** — The dream and theoretical grounding.
- **[Pragma (Concrete State)](../docs/logos/pragma.md)** — The honest account of what exists.
- **[Praxis (Remediation Plan)](../docs/logos/praxis.md)** — The attack vectors for evolution.
- **[Receptio (Reception)](../docs/logos/receptio.md)** — The account of the constructed polis.

### Alchemical I/O
- **[Source & Transmutation](../docs/logos/alchemical-io.md)** — Narrative of inputs, process, and returns.



*Compliance: Record exists without implementation.*

<!-- ORGANVM:AUTO:END -->

















## ⚡ Conductor OS Integration
This repository is a managed component of the ORGANVM meta-workspace.
- **Orchestration:** Use `conductor patch` for system status and work queue.
- **Lifecycle:** Follow the `FRAME -> SHAPE -> BUILD -> PROVE` workflow.
- **Governance:** Promotions are managed via `conductor wip promote`.
- **Intelligence:** Conductor MCP tools are available for routing and mission synthesis.