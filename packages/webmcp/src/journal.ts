import type { OperationJournal, OperationJournalOptions } from "./types.js";

export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * JSON operation journal backed by localStorage, sessionStorage, or a compatible
 * application store. Choose the storage lifetime deliberately.
 */
export class WebStorageOperationJournal implements OperationJournal {
  constructor(
    private readonly storage: WebStorageLike,
    private readonly prefix = "signett:operation:",
  ) {}

  read<Entry>(
    key: string,
    options: OperationJournalOptions,
  ): Entry | undefined {
    options.signal.throwIfAborted();
    const encoded = this.storage.getItem(this.prefix + key);
    if (encoded === null) return undefined;
    return JSON.parse(encoded) as Entry;
  }

  write<Entry>(
    key: string,
    entry: Entry,
    options: OperationJournalOptions,
  ): void {
    options.signal.throwIfAborted();
    this.storage.setItem(this.prefix + key, JSON.stringify(entry));
  }

  remove(key: string, options: OperationJournalOptions): void {
    options.signal.throwIfAborted();
    this.storage.removeItem(this.prefix + key);
  }
}
