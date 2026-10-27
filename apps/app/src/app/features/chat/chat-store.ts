import { Injectable } from '@angular/core';

/**
 * Which run a chat produced, for the lifetime of the page session only: `ChatSession` carries
 * no `runId`, so a full reload cannot re-derive it. In memory on purpose, never persisted.
 */
@Injectable({ providedIn: 'root' })
export class ChatRunLink {
  private readonly links = new Map<string, string>();

  remember(chatId: string, runId: string): void {
    this.links.set(chatId, runId);
  }

  runIdFor(chatId: string): string | null {
    return this.links.get(chatId) ?? null;
  }

  forget(chatId: string): void {
    this.links.delete(chatId);
  }

  clear(): void {
    this.links.clear();
  }
}
