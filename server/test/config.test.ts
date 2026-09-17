import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://x' };

describe('loadConfig', () => {
  it('fills defaults and enables only testnet when mainnet url is unset', () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(8080);
    expect(cfg.publicBaseUrl).toBe('http://localhost:8080');
    expect(cfg.networks.testnet.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(cfg.networks.testnet.passphrase).toBe('Test SDF Network ; September 2015');
    expect(cfg.networks.mainnet).toBeUndefined();
    expect(cfg.corsOrigins).toEqual(['http://localhost:3000']);
  });
  it('enables mainnet when RPC_URL_MAINNET is set', () => {
    const cfg = loadConfig({ ...base, RPC_URL_MAINNET: 'https://rpc.example' });
    expect(cfg.networks.mainnet?.passphrase).toBe('Public Global Stellar Network ; September 2015');
  });
  it('throws without DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
  it('strips a trailing slash from PUBLIC_BASE_URL and splits CORS origins', () => {
    const cfg = loadConfig({ ...base, PUBLIC_BASE_URL: 'https://api.x/', CORS_ORIGINS: 'a, b' });
    expect(cfg.publicBaseUrl).toBe('https://api.x');
    expect(cfg.corsOrigins).toEqual(['a', 'b']);
  });
});
