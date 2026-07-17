import { migration_001_init } from './001_init';

// Ordered list of migrations. Each entry's `name` is the key tracked in the _migrations table —
// never rename an already-shipped entry, only append new ones.
export const MIGRATIONS: { name: string; sql: string }[] = [
  { name: '001_init', sql: migration_001_init },
];
