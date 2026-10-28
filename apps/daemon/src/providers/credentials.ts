import { createCredentialsService } from '../credentials/service.js';
import { CREDENTIAL_NAME_MAX_LENGTH } from '../credentials/schemas.js';
import type { PublicCredential } from '../credentials/schemas.js';
import type { CredentialsService } from '../credentials/index.js';
import type { DaemonContext } from '../modules.js';

export interface ProviderCredentialPort {
  create(input: { readonly name: string; readonly value: string }): {
    readonly id: string;
    readonly lastFour: string;
  };
  lastFour(id: string): string;
  remove(id: string): void;
}

const SERVICES = new WeakMap<DaemonContext, CredentialsService>();

function credentialsOf(context: DaemonContext): CredentialsService {
  const existing = SERVICES.get(context);
  if (existing !== undefined) return existing;
  const service = createCredentialsService({ context });
  SERVICES.set(context, service);
  return service;
}

function atMostFour(value: string): string {
  return value.length > 4 ? value.slice(-4) : value;
}

function fourOf(credential: PublicCredential): string {
  return atMostFour(credential.lastFour);
}

/** Wraps Task-58's store: `kind: 'model_key'`, `expose: 'daemon'`, never returns the value. */
export function createProviderCredentialPort(context: DaemonContext): ProviderCredentialPort {
  const credentials = credentialsOf(context);
  return {
    create(input: { readonly name: string; readonly value: string }): {
      readonly id: string;
      readonly lastFour: string;
    } {
      const credential = credentials.create({
        name: input.name.slice(0, CREDENTIAL_NAME_MAX_LENGTH),
        kind: 'model_key',
        expose: 'daemon',
        value: input.value,
      });
      return { id: credential.id, lastFour: fourOf(credential) };
    },

    lastFour(id: string): string {
      const credential = credentials.list().find((candidate) => candidate.id === id);
      return credential === undefined ? '' : fourOf(credential);
    },

    remove(id: string): void {
      const known = credentials.list().some((candidate) => candidate.id === id);
      if (!known) return;
      credentials.remove(id);
    },
  };
}
