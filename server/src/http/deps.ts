import type pino from 'pino';
import type { Config } from '../config.js';
import type { Chain } from '../chain/types.js';
import type { Registry } from '../registry/registry.js';
import type { Store } from '../registry/store.js';
import type { AuthKeys } from '../auth/keys.js';
import type { ChallengeDeps, ChallengeVerifier } from '../auth/challenge.js';
export type Auth = { keys: AuthKeys; challenge: ChallengeDeps; verifier: ChallengeVerifier };
export type Deps = { cfg: Config; chain: Chain; registry: Registry; store: Store; log: pino.Logger; auth: Auth };
