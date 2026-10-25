import { Injectable, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import type { SseStreamEvent } from '@codebox/contracts';
import { API_BASE_URL, API_PREFIX } from '../api/http';
import { AuthStore } from '../auth/auth.store';
import { toStreamEvent } from './events';
import type { SseConnectionState } from './events';
import { createSseClient } from './sse-client';
import type { SseClient, SseFrame } from './sse-client';

@Injectable({ providedIn: 'root' })
export class SseService {
  private readonly auth = inject(AuthStore);
  private readonly stateSignal = signal<SseConnectionState>('closed');
  private readonly eventSignal = signal<SseStreamEvent | null>(null);
  private readonly resumeSignal = signal(0);
  private client: SseClient | null = null;

  readonly state = this.stateSignal.asReadonly();
  readonly event: Signal<SseStreamEvent | null> = this.eventSignal.asReadonly();
  readonly resumePoint = this.resumeSignal.asReadonly();

  start(afterId: number = this.resumeSignal()): void {
    this.client ??= this.createClient();
    this.client.start(afterId);
  }

  stop(): void {
    this.client?.stop();
    this.stateSignal.set('closed');
  }

  markProcessed(id: number): void {
    this.resumeSignal.set(id);
    this.client?.markProcessed(id);
  }

  private createClient(): SseClient {
    return createSseClient({
      url: `${API_BASE_URL}${API_PREFIX}/events`,
      token: () => this.auth.accessToken(),
      fetch: (input, init) => globalThis.fetch(input, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: () => Math.random(),
      onFrame: (frame) => this.handleFrame(frame),
      onGap: (gap) => {
        this.resumeSignal.set(gap.latestId);
      },
      onState: (state) => this.stateSignal.set(state),
    });
  }

  private handleFrame(frame: SseFrame): void {
    const event = toStreamEvent(frame);
    if (event !== null) this.eventSignal.set(event);
  }
}
