import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Health, Version } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { AboutStore } from './about.store';

const VERSION: Version = {
  version: '9.9.9-test',
  commit: 'deadbee',
  builtAt: '2026-01-02T03:04:05Z',
  node: 'v24.9.1',
};

const HEALTH: Health = {
  status: 'ok',
  db: 'ok',
  opencode: 'degraded',
  disk: { freeBytes: 12_000, totalBytes: 48_000, usedPercent: 75 },
  queue: { pending: 2, running: 1, maxConcurrency: 4 },
  version: '0.1.0',
};

const VERSION_URL = '/v1/version';
const HEALTH_URL = '/v1/health';

function envelope(code: string): Record<string, unknown> {
  return { error: { code, message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } };
}

function failure(): { status: number; statusText: string } {
  return { status: 500, statusText: 'Internal Server Error' };
}

describe('AboutStore', () => {
  let http: HttpTestingController;
  let store: AboutStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AboutStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AboutStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads version and health and clears loading only when both settle', () => {
    store.load();

    expect(store.loading()).toBe(true);
    http.expectOne(VERSION_URL).flush(VERSION);

    expect(store.loading()).toBe(true);
    expect(store.version()).toEqual(VERSION);

    http.expectOne(HEALTH_URL).flush(HEALTH);

    expect(store.loading()).toBe(false);
    expect(store.health()).toEqual(HEALTH);
    expect(store.error()).toBeNull();
  });

  it('keeps the version when the health read fails', () => {
    store.load();
    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(HEALTH_URL).flush(envelope('internal'), failure());

    expect(store.version()).toEqual(VERSION);
    expect(store.health()).toBeNull();
    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.loading()).toBe(false);
  });

  it('keeps the health rows when the version read fails', () => {
    store.load();
    http.expectOne(HEALTH_URL).flush(HEALTH);
    http.expectOne(VERSION_URL).flush(envelope('internal'), failure());

    expect(store.health()).toEqual(HEALTH);
    expect(store.version()).toBeNull();
    expect(store.error()).toMatchObject({ code: 'internal' });
    expect(store.loading()).toBe(false);
  });

  it('reloads both reads with the error cleared first', () => {
    store.load();
    http.expectOne(VERSION_URL).flush(envelope('internal'), failure());
    http.expectOne(HEALTH_URL).flush(envelope('internal'), failure());
    expect(store.error()).not.toBeNull();

    store.reload();

    expect(store.error()).toBeNull();
    expect(store.loading()).toBe(true);

    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(HEALTH_URL).flush(HEALTH);

    expect(store.error()).toBeNull();
    expect(store.version()).toEqual(VERSION);
    expect(store.health()).toEqual(HEALTH);
    expect(store.loading()).toBe(false);
  });
});
