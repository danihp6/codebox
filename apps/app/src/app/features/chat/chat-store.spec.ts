import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatRunLink } from './chat-store';

const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';
const OTHER_CHAT = 'chat_01JABCDEFGHJKMNPQRSW';
const RUN = 'run_01JABCDEFGHJKMNPQRSV';
const OTHER_RUN = 'run_01JABCDEFGHJKMNPQRSW';

describe('ChatRunLink', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('remembers one run id per chat and forgets it on request', () => {
    const link = TestBed.inject(ChatRunLink);
    expect(link.runIdFor(CHAT)).toBeNull();

    link.remember(CHAT, RUN);
    link.remember(OTHER_CHAT, OTHER_RUN);

    expect(link.runIdFor(CHAT)).toBe(RUN);
    expect(link.runIdFor(OTHER_CHAT)).toBe(OTHER_RUN);

    link.forget(CHAT);
    expect(link.runIdFor(CHAT)).toBeNull();
    expect(link.runIdFor(OTHER_CHAT)).toBe(OTHER_RUN);
  });

  it('overwrites the run of a chat and clears every link', () => {
    const link = TestBed.inject(ChatRunLink);
    link.remember(CHAT, RUN);
    link.remember(CHAT, OTHER_RUN);
    expect(link.runIdFor(CHAT)).toBe(OTHER_RUN);

    link.remember(OTHER_CHAT, RUN);
    link.clear();

    expect(link.runIdFor(CHAT)).toBeNull();
    expect(link.runIdFor(OTHER_CHAT)).toBeNull();
  });
});
