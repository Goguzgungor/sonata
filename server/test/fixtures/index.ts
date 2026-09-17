import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
export function loadFixtureWasm(): Buffer { return readFileSync(join(here, 'kitchen-sink', 'kitchen_sink.wasm')); }
