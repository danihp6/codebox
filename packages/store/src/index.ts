// Errors: the codes the daemon maps to HTTP (docs/api.md §3).
export { StoreError } from './errors.js';
export type { StoreErrorCode } from './errors.js';

// Connection: WAL, foreign keys, transactions and SQLite error classification.
export {
  openDatabase,
  withTransaction,
  isUniqueViolation,
  isForeignKeyViolation,
  isCheckViolation,
} from './db.js';
export type { OpenDatabaseOptions } from './db.js';

// Migrations: numbered SQL files, checksum-pinned, forward only.
export { MIGRATIONS_DIRECTORY, loadMigrationsFromDisk, runMigrations } from './migrate.js';
export type { MigrationFile, AppliedMigration, MigrationReport } from './migrate.js';

// Pagination: the opaque cursor and the page envelope of docs/api.md §4.
export { encodeCursor, decodeCursor } from './cursor.js';
export type { PageQuery, PageResult } from './cursor.js';

// Store: one connection and every repository.
export { openStore, openInMemoryStore } from './store.js';
export type { Store, OpenStoreOptions } from './store.js';

// Repositories.
export type { RepoPatch, RepoRepository } from './repos.js';
export type { JobFilter, JobPatch, JobRepository } from './jobs.js';
export { toRun } from './runs.js';
export type {
  RunRecord,
  RunFilter,
  RunPatch,
  ClaimScheduledRunInput,
  RunRepository,
} from './runs.js';
export type { EventRecord, NewEventRecord, EventRepository } from './events.js';
export type { ApprovalRepository } from './approvals.js';
export { toChatSession } from './chats.js';
export type {
  ChatMessageOrigin,
  ChatSessionExtra,
  ChatSessionPatch,
  ChatRepository,
} from './chats.js';
export type { DeviceRecord, DeviceRepository } from './devices.js';
export type { SettingsRepository } from './settings.js';
export type { UsageRecord, UsageAggregate, UsageRepository } from './usage.js';
export type { RoutineFilter, RoutinePatch, RoutineRepository } from './routines.js';
export type {
  RoutineFireOutcome,
  RoutineFireRecord,
  ClaimRoutineFireInput,
  RoutineFireRepository,
} from './routine-fires.js';
export type { ScheduleFilter, SchedulePatch, ScheduleRepository } from './schedules.js';
export type {
  ScheduleFireRecord,
  ClaimScheduleFireInput,
  FinishScheduleFireInput,
  ScheduleFireRepository,
} from './schedule-fires.js';
