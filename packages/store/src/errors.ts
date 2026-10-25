export type StoreErrorCode =
  | 'not_found'
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'repo_has_live_run'
  | 'nested_transaction'
  | 'invalid_row'
  | 'check_violation'
  | 'migration_invalid'
  | 'migration_checksum'
  | 'migration_failed';

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}
