import { BaseMessage } from "@langchain/core/messages";
import { AgentState } from "./types";

interface SessionSnapshot {
  state: AgentState;
  updatedAt: number;
}

export class InMemorySessionStore {
  private readonly sessions: Map<string, SessionSnapshot> = new Map();

  get(sessionId: string): AgentState | null {
    return this.sessions.get(sessionId)?.state ?? null;
  }

  set(sessionId: string, state: AgentState): void {
    this.sessions.set(sessionId, { state, updatedAt: Date.now() });
  }

  merge(sessionId: string, patch: Partial<AgentState>): AgentState {
    const existing = this.get(sessionId);
    if (!existing) {
      throw new Error(`session not found: ${sessionId}`);
    }

    const nextMessages = patch.messages
      ? [...existing.messages, ...patch.messages]
      : existing.messages;

    const nextState: AgentState = {
      ...existing,
      ...patch,
      messages: nextMessages as BaseMessage[]
    };

    this.set(sessionId, nextState);
    return nextState;
  }
}

export const sessionStore = new InMemorySessionStore();
