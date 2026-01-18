import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type {
  SessionState,
  SessionStatus,
  ConversationMessage,
  CheckpointData,
  SessionError,
  ToolCallRecord,
} from '../agents/types.js';

// ============================================================================
// Session Store
// ============================================================================

interface SessionStoreConfig {
  /** Directory to store session files */
  storagePath: string;
  /** File extension for session files */
  fileExtension?: string;
  /** How long to keep completed sessions (ms) */
  completedSessionTtlMs?: number;
  /** Auto-save interval for running sessions (ms) */
  autoSaveIntervalMs?: number;
}

/**
 * Persistent session storage for long-running agent sessions
 */
export class SessionStore {
  private readonly storagePath: string;
  private readonly fileExtension: string;
  private readonly completedSessionTtlMs: number;
  private readonly autoSaveIntervalMs: number;

  // In-memory cache of active sessions
  private sessions: Map<string, SessionState> = new Map();
  private autoSaveTimers: Map<string, NodeJS.Timeout> = new Map();
  private initialized = false;

  constructor(config: SessionStoreConfig) {
    this.storagePath = config.storagePath;
    this.fileExtension = config.fileExtension ?? '.session.json';
    this.completedSessionTtlMs = config.completedSessionTtlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    this.autoSaveIntervalMs = config.autoSaveIntervalMs ?? 30000; // 30 seconds
  }

  /**
   * Initialize the session store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure storage directory exists
    try {
      await mkdir(this.storagePath, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Load any existing sessions
    await this.loadExistingSessions();

    this.initialized = true;
  }

  /**
   * Create a new session
   */
  async createSession(params: {
    agentId: string;
    prompt: string;
    workingDirectory: string;
    env: Record<string, string>;
    maxTurns: number;
    parentSessionId?: string;
  }): Promise<SessionState> {
    await this.ensureInitialized();

    const session: SessionState = {
      id: randomUUID(),
      agentId: params.agentId,
      status: 'running',
      prompt: params.prompt,
      workingDirectory: params.workingDirectory,
      env: params.env,
      parentSessionId: params.parentSessionId,
      childSessionIds: [],
      currentTurn: 0,
      maxTurns: params.maxTurns,
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // If this is a child session, update parent
    if (params.parentSessionId) {
      const parent = this.sessions.get(params.parentSessionId);
      if (parent) {
        parent.childSessionIds.push(session.id);
        await this.saveSession(parent);
      }
    }

    this.sessions.set(session.id, session);
    await this.saveSession(session);

    // Start auto-save timer
    this.startAutoSave(session.id);

    console.log(`[SessionStore] Created session ${session.id} for agent ${params.agentId}`);

    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<SessionState | null> {
    await this.ensureInitialized();

    // Check memory cache first
    const cachedSession = this.sessions.get(sessionId);
    if (cachedSession) {
      return cachedSession;
    }

    // Try to load from disk
    const loadedSession = await this.loadSessionFromDisk(sessionId);
    if (loadedSession) {
      this.sessions.set(sessionId, loadedSession);
      return loadedSession;
    }

    return null;
  }

  /**
   * Update session status
   */
  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.status = status;
    session.updatedAt = new Date().toISOString();

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      session.completedAt = new Date().toISOString();
      this.stopAutoSave(sessionId);
    }

    await this.saveSession(session);
  }

  /**
   * Update session turn
   */
  async updateTurn(sessionId: string, turn: number): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.currentTurn = turn;
    session.updatedAt = new Date().toISOString();

    await this.saveSession(session);
  }

  /**
   * Add message to conversation history
   */
  async addMessage(sessionId: string, message: Omit<ConversationMessage, 'timestamp'>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.conversationHistory.push({
      ...message,
      timestamp: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();

    await this.saveSession(session);
  }

  /**
   * Save checkpoint data for resumption
   */
  async saveCheckpoint(
    sessionId: string,
    checkpoint: Omit<CheckpointData, 'timestamp'>
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.checkpoint = {
      ...checkpoint,
      timestamp: new Date().toISOString(),
    };
    session.updatedAt = new Date().toISOString();

    await this.saveSession(session);
    console.log(`[SessionStore] Checkpoint saved for session ${sessionId} at turn ${checkpoint.lastTurn}`);
  }

  /**
   * Record tool call in checkpoint
   */
  async recordToolCall(sessionId: string, toolCall: ToolCallRecord): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.checkpoint) {
      session.checkpoint = {
        lastTurn: session.currentTurn,
        toolCallHistory: [],
        timestamp: new Date().toISOString(),
      };
    }

    session.checkpoint.toolCallHistory.push(toolCall);
    session.checkpoint.timestamp = new Date().toISOString();
    session.updatedAt = new Date().toISOString();

    // Don't save immediately for tool calls - rely on auto-save
    this.sessions.set(sessionId, session);
  }

  /**
   * Set session error
   */
  async setError(sessionId: string, error: Omit<SessionError, 'lastRetryAt'>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.error = {
      ...error,
      lastRetryAt: new Date().toISOString(),
    };
    session.updatedAt = new Date().toISOString();

    await this.saveSession(session);
  }

  /**
   * Set session result
   */
  async setResult(sessionId: string, result: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.result = result;
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();

    this.stopAutoSave(sessionId);
    await this.saveSession(session);
  }

  /**
   * List sessions with optional filters
   */
  async listSessions(filters?: {
    status?: SessionStatus[];
    agentId?: string;
    parentSessionId?: string | null;
  }): Promise<SessionState[]> {
    await this.ensureInitialized();

    let sessions = Array.from(this.sessions.values());

    if (filters?.status) {
      sessions = sessions.filter(s => filters.status!.includes(s.status));
    }

    if (filters?.agentId) {
      sessions = sessions.filter(s => s.agentId === filters.agentId);
    }

    if (filters?.parentSessionId !== undefined) {
      if (filters.parentSessionId === null) {
        sessions = sessions.filter(s => !s.parentSessionId);
      } else {
        sessions = sessions.filter(s => s.parentSessionId === filters.parentSessionId);
      }
    }

    return sessions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureInitialized();

    this.stopAutoSave(sessionId);
    this.sessions.delete(sessionId);

    const filePath = this.getSessionFilePath(sessionId);
    try {
      await unlink(filePath);
      console.log(`[SessionStore] Deleted session ${sessionId}`);
    } catch {
      // File might not exist
    }
  }

  /**
   * Clean up old completed sessions
   */
  async cleanupOldSessions(): Promise<number> {
    await this.ensureInitialized();

    const now = Date.now();
    let deletedCount = 0;

    for (const session of this.sessions.values()) {
      if (
        (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') &&
        session.completedAt
      ) {
        const completedTime = new Date(session.completedAt).getTime();
        if (now - completedTime > this.completedSessionTtlMs) {
          await this.deleteSession(session.id);
          deletedCount++;
        }
      }
    }

    console.log(`[SessionStore] Cleaned up ${deletedCount} old sessions`);
    return deletedCount;
  }

  /**
   * Get session file path
   */
  private getSessionFilePath(sessionId: string): string {
    return join(this.storagePath, `${sessionId}${this.fileExtension}`);
  }

  /**
   * Save session to disk
   */
  private async saveSession(session: SessionState): Promise<void> {
    const filePath = this.getSessionFilePath(session.id);
    await writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Load session from disk
   */
  private async loadSessionFromDisk(sessionId: string): Promise<SessionState | null> {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as SessionState;
    } catch {
      return null;
    }
  }

  /**
   * Load existing sessions from disk
   */
  private async loadExistingSessions(): Promise<void> {
    try {
      const files = await readdir(this.storagePath);
      const sessionFiles = files.filter(f => f.endsWith(this.fileExtension));

      for (const file of sessionFiles) {
        const sessionId = file.replace(this.fileExtension, '');
        const session = await this.loadSessionFromDisk(sessionId);

        if (session) {
          this.sessions.set(session.id, session);

          // Restart auto-save for running/paused sessions
          if (session.status === 'running' || session.status === 'paused') {
            this.startAutoSave(session.id);
          }
        }
      }

      console.log(`[SessionStore] Loaded ${this.sessions.size} existing sessions`);
    } catch {
      // Directory might be empty or not exist yet
    }
  }

  /**
   * Start auto-save timer for a session
   */
  private startAutoSave(sessionId: string): void {
    this.stopAutoSave(sessionId);

    const timer = setInterval(async () => {
      const session = this.sessions.get(sessionId);
      if (session && (session.status === 'running' || session.status === 'paused')) {
        await this.saveSession(session);
      } else {
        this.stopAutoSave(sessionId);
      }
    }, this.autoSaveIntervalMs);

    this.autoSaveTimers.set(sessionId, timer);
  }

  /**
   * Stop auto-save timer for a session
   */
  private stopAutoSave(sessionId: string): void {
    const timer = this.autoSaveTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.autoSaveTimers.delete(sessionId);
    }
  }

  /**
   * Ensure store is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Shutdown - save all sessions and stop timers
   */
  async shutdown(): Promise<void> {
    // Stop all auto-save timers
    for (const sessionId of this.autoSaveTimers.keys()) {
      this.stopAutoSave(sessionId);
    }

    // Save all active sessions
    for (const session of this.sessions.values()) {
      if (session.status === 'running') {
        session.status = 'paused';
        session.updatedAt = new Date().toISOString();
        await this.saveSession(session);
      }
    }

    console.log('[SessionStore] Shutdown complete');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let defaultStore: SessionStore | null = null;

export function getSessionStore(config?: SessionStoreConfig): SessionStore {
  if (!defaultStore) {
    if (!config) {
      config = {
        storagePath: './.sessions',
      };
    }
    defaultStore = new SessionStore(config);
  }
  return defaultStore;
}

export function resetSessionStore(): void {
  if (defaultStore) {
    defaultStore.shutdown().catch(console.error);
  }
  defaultStore = null;
}
