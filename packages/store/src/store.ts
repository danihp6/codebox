import type { DatabaseSync } from 'node:sqlite';
import { createApprovalRepository, type ApprovalRepository } from './approvals.js';
import { createChatRepository, type ChatRepository } from './chats.js';
import { openDatabase } from './db.js';
import { createDeviceRepository, type DeviceRepository } from './devices.js';
import { createEventRepository, type EventRepository } from './events.js';
import { createJobRepository, type JobRepository } from './jobs.js';
import { createLegacyRepository, type LegacyRepository } from './legacy.js';
import { loadMigrationsFromDisk, MIGRATIONS_DIRECTORY, runMigrations } from './migrate.js';
import {
  createProviderAccountRepository,
  createProviderRepository,
  type ProviderAccountRepository,
  type ProviderRepository,
} from './providers.js';
import { createRepoScheduleRepository, type RepoScheduleRepository } from './repo-schedules.js';
import { createRepoRepository, type RepoRepository } from './repos.js';
import { createRoutineFireRepository, type RoutineFireRepository } from './routine-fires.js';
import { createRoutineRepository, type RoutineRepository } from './routines.js';
import { createScheduleFireRepository, type ScheduleFireRepository } from './schedule-fires.js';
import { createScheduleRepository, type ScheduleRepository } from './schedules.js';
import { createRunRepository, type RunRepository } from './runs.js';
import { createSessionRepository, type SessionRepository } from './sessions.js';
import { createSettingsRepository, type SettingsRepository } from './settings.js';
import { createUsageRepository, type UsageRepository } from './usage.js';
import { createWorkRepository, type WorkRepository } from './works.js';
import { row, textColumn } from './mappers.js';

export interface Store {
  readonly db: DatabaseSync;
  readonly schemaVersion: number;
  readonly repos: RepoRepository;
  readonly jobs: JobRepository;
  readonly runs: RunRepository;
  readonly events: EventRepository;
  readonly approvals: ApprovalRepository;
  readonly chats: ChatRepository;
  readonly devices: DeviceRepository;
  readonly settings: SettingsRepository;
  readonly usage: UsageRepository;
  readonly routines: RoutineRepository;
  readonly routineFires: RoutineFireRepository;
  readonly schedules: ScheduleRepository;
  readonly scheduleFires: ScheduleFireRepository;
  readonly works: WorkRepository;
  readonly sessions: SessionRepository;
  readonly repoSchedules: RepoScheduleRepository;
  readonly providers: ProviderRepository;
  readonly providerAccounts: ProviderAccountRepository;
  readonly legacy: LegacyRepository;
  close(): void;
}

export interface OpenStoreOptions {
  readonly path: string;
  readonly applyMigrations?: boolean;
  readonly busyTimeoutMs?: number;
}

// OpenStoreOptions carries no clock, so the migration bookkeeping timestamp comes from SQLite
// itself. No repository timestamp is ever read here: those are caller arguments.
function migrationClock(db: DatabaseSync): string {
  const value = db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS at").get();
  return textColumn(row(value), 'at');
}

function readSchemaVersion(db: DatabaseSync): number {
  const value = db.prepare('PRAGMA user_version').get()?.['user_version'];
  return value === null || value === undefined ? 0 : Number(value);
}

export function openStore(options: OpenStoreOptions): Store {
  const databaseOptions =
    options.busyTimeoutMs === undefined
      ? { path: options.path }
      : { path: options.path, busyTimeoutMs: options.busyTimeoutMs };
  const db = openDatabase(databaseOptions);
  if (options.applyMigrations ?? true) {
    runMigrations(db, loadMigrationsFromDisk(MIGRATIONS_DIRECTORY), () => migrationClock(db));
  }

  let closed = false;
  return {
    db,
    schemaVersion: readSchemaVersion(db),
    repos: createRepoRepository(db),
    jobs: createJobRepository(db),
    runs: createRunRepository(db),
    events: createEventRepository(db),
    approvals: createApprovalRepository(db),
    chats: createChatRepository(db),
    devices: createDeviceRepository(db),
    settings: createSettingsRepository(db),
    usage: createUsageRepository(db),
    routines: createRoutineRepository(db),
    routineFires: createRoutineFireRepository(db),
    schedules: createScheduleRepository(db),
    scheduleFires: createScheduleFireRepository(db),
    works: createWorkRepository(db),
    sessions: createSessionRepository(db),
    repoSchedules: createRepoScheduleRepository(db),
    providers: createProviderRepository(db),
    providerAccounts: createProviderAccountRepository(db),
    legacy: createLegacyRepository(db),
    close(): void {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

export function openInMemoryStore(): Store {
  return openStore({ path: ':memory:' });
}
