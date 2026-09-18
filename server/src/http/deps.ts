import type pino from 'pino';
import type { Config } from '../config.js';
import type { Chain } from '../chain/types.js';
import type { Registry } from '../registry/registry.js';
import type { Store } from '../registry/store.js';
export type Deps = { cfg: Config; chain: Chain; registry: Registry; store: Store; log: pino.Logger };
