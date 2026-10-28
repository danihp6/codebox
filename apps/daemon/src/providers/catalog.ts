import type { Provider, ProviderAuthKind, ProviderId } from '@codebox/contracts';
import { StoreError } from '@codebox/store';
import type { Store } from '@codebox/store';

export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly label: string;
  readonly authKind: ProviderAuthKind;
}

/** The adapters the box knows before any account exists. `docs/providers.md` §5.1. */
export const PROVIDER_CATALOG: readonly ProviderDescriptor[] = Object.freeze([
  { id: 'opencode-go', label: 'OpenCode Go', authKind: 'oauth' },
  { id: 'anthropic', label: 'Anthropic', authKind: 'token' },
  { id: 'openai', label: 'OpenAI', authKind: 'token' },
]);

/** Catalog order first, then id, so a provider added outside the catalog still has a place. */
export function providerCatalogRank(id: string): number {
  const index = PROVIDER_CATALOG.findIndex((descriptor) => descriptor.id === id);
  return index === -1 ? PROVIDER_CATALOG.length : index;
}

/** Inserts the missing catalog rows. Idempotent; a second call changes nothing. */
export function seedProviderCatalog(store: Store, at: string): readonly Provider[] {
  for (const descriptor of PROVIDER_CATALOG) {
    if (store.providers.get(descriptor.id) !== null) continue;
    try {
      store.providers.create({
        id: descriptor.id,
        label: descriptor.label,
        authKind: descriptor.authKind,
        baseUrl: null,
        createdAt: at,
        updatedAt: at,
      });
    } catch (error) {
      // Two concurrent seeds race on the primary key; the winner's row is the one that stays.
      if (!(error instanceof StoreError) || error.code !== 'unique_violation') throw error;
    }
  }
  return [...store.providers.list()].sort((left, right) => {
    const delta = providerCatalogRank(left.id) - providerCatalogRank(right.id);
    if (delta !== 0) return delta;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
