import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { SECRETS_DIRECTORY } from '../credentials/storage.js';
import type { IntegrationAuth } from '../credentials/schemas.js';
import { storedIntegrationSchema } from '../credentials/schemas.js';

export const INTEGRATIONS_DIRECTORY = 'integrations';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const FILE_PATTERN = /^[A-Za-z0-9_-]+\.json$/;
const ID_PATTERN = /^[A-Za-z0-9_]+$/;

export interface StoredIntegration {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly auth: IntegrationAuth;
  readonly headerName: string | null;
  readonly credentialId: string | null;
  readonly allowedHosts: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IntegrationStorage {
  list(): readonly StoredIntegration[];
  get(id: string): StoredIntegration | null;
  save(integration: StoredIntegration): void;
  remove(id: string): void;
}

/** `${CB_STATE_DIR}/secrets/integrations`, beside the sealed credentials. */
export function integrationsDirectory(stateDir: string): string {
  return join(stateDir, SECRETS_DIRECTORY, INTEGRATIONS_DIRECTORY);
}

export function createFileIntegrationStorage(options: {
  readonly directory: string;
}): IntegrationStorage {
  const directory = options.directory;

  function ensureDirectory(): void {
    mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
    if ((statSync(directory).mode & 0o777) !== DIRECTORY_MODE) chmodSync(directory, DIRECTORY_MODE);
  }

  function fileFor(id: string): string | null {
    return ID_PATTERN.test(id) ? join(directory, `${id}.json`) : null;
  }

  function isFile(path: string): boolean {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }

  function read(file: string): StoredIntegration | null {
    if ((statSync(file).mode & 0o777) !== FILE_MODE) chmodSync(file, FILE_MODE);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    const parsed = storedIntegrationSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  function get(id: string): StoredIntegration | null {
    const file = fileFor(id);
    if (file === null || !isFile(file)) return null;
    return read(file);
  }

  return {
    list(): readonly StoredIntegration[] {
      ensureDirectory();
      const integrations: StoredIntegration[] = [];
      const entries = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
        .map((entry) => entry.name);
      for (const name of entries) {
        const integration = read(join(directory, name));
        if (integration !== null) integrations.push(integration);
      }
      return integrations.sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : right.createdAt.localeCompare(left.createdAt),
      );
    },
    get,
    save(integration: StoredIntegration): void {
      const file = fileFor(integration.id);
      if (file === null) throw new Error('invalid integration id');
      ensureDirectory();
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(integration)}\n`, {
        encoding: 'utf8',
        mode: FILE_MODE,
      });
      chmodSync(temporary, FILE_MODE);
      renameSync(temporary, file);
    },
    remove(id: string): void {
      const file = fileFor(id);
      if (file === null) return;
      rmSync(file, { force: true });
      rmSync(`${file}.tmp`, { force: true });
    },
  };
}
