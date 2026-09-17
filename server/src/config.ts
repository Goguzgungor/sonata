import type { Network } from './types.js';

export type NetworkConfig = { rpcUrl: string; passphrase: string };
export type Config = {
  port: number;
  databaseUrl: string;
  publicBaseUrl: string;
  networks: Partial<Record<Network, NetworkConfig>>;
  simSourceAccount: string;
  corsOrigins: string[];
  logLevel: string;
};

export const PASSPHRASES: Record<Network, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015'
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const networks: Config['networks'] = {
    testnet: { rpcUrl: env.RPC_URL_TESTNET || 'https://soroban-testnet.stellar.org', passphrase: PASSPHRASES.testnet }
  };
  if (env.RPC_URL_MAINNET) networks.mainnet = { rpcUrl: env.RPC_URL_MAINNET, passphrase: PASSPHRASES.mainnet };
  return {
    port: Number(env.PORT || 8080),
    databaseUrl: env.DATABASE_URL,
    publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/+$/, ''),
    networks,
    simSourceAccount: env.SIM_SOURCE_ACCOUNT || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    logLevel: env.LOG_LEVEL || 'info'
  };
}
