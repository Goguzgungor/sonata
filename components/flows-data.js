import { API_URL } from './data';

/* Published Sonata flows: minimal-input, spec-driven transaction builders (sample data). */
export const FLOWS = [
  { slug: 'stellarswap-swap', name: 'StellarSwap: Swap', intent: 'swap', protocol: 'stellarswap', kind: 'Single call',
    d: 'Swap token A for token B through a StellarSwap pool. Pool reserves, fee and the caller\'s token balances are read on-chain, so you only pass the amount and a slippage guard.',
    inputs: [['wallet', 'Address', 'Signer and source of funds'], ['pool', 'Address', 'StellarSwap pool contract'], ['amountIn', 'i128', 'Amount to sell'], ['minAmountOut', 'i128', 'Slippage guard'], ['aToB', 'bool', 'Direction']] },
  { slug: 'stellarswap-add-liquidity', name: 'StellarSwap: Add liquidity', intent: 'deposit', protocol: 'stellarswap', kind: 'Chained',
    d: 'Approve both tokens and deposit into a pool in a single transaction. Desired amounts are balanced against current reserves.',
    inputs: [['wallet', 'Address', 'Signer'], ['pool', 'Address', 'Pool contract'], ['amountA', 'i128', 'Token A amount'], ['amountB', 'i128', 'Token B amount']] },
  { slug: 'yieldvault-deposit', name: 'YieldVault: Deposit', intent: 'deposit', protocol: 'yieldvault', kind: 'Chained',
    d: 'Approve and deposit into a YieldVault in one transaction. Share price and vault asset are read from the vault.',
    inputs: [['wallet', 'Address', 'Signer'], ['vault', 'Address', 'Vault contract'], ['amount', 'i128', 'Asset amount']] },
  { slug: 'yieldvault-claim', name: 'YieldVault: Claim rewards', intent: 'claim', protocol: 'yieldvault', kind: 'Single call',
    d: 'Claim accrued rewards. Reward asset and pending balance are resolved from the vault, so the wallet is the only input.',
    inputs: [['wallet', 'Address', 'Signer']] },
  { slug: 'usdc-stream-create', name: 'USDC Stream: Create stream', intent: 'create', protocol: 'usdc-stream', kind: 'Chained',
    d: 'Approve USDC and open a per-second vesting stream to a recipient.',
    inputs: [['sender', 'Address', 'Signer'], ['recipient', 'Address', 'Receiver'], ['amount', 'i128', 'Total USDC'], ['seconds', 'u64', 'Duration']] },
  { slug: 'usdc-stream-cancel', name: 'USDC Stream: Cancel', intent: 'cancel', protocol: 'usdc-stream', kind: 'Single call',
    d: 'Cancel a stream and return the unvested balance to the sender.',
    inputs: [['sender', 'Address', 'Signer'], ['stream', 'u64', 'Stream id']] },
  { slug: 'sac-transfer', name: 'Stellar asset: Transfer', intent: 'transfer', protocol: 'sac', kind: 'Single call',
    d: 'Transfer any classic Stellar asset through its Stellar Asset Contract. The contract address is derived from the asset code and issuer.',
    inputs: [['from', 'Address', 'Signer'], ['to', 'Address', 'Receiver'], ['asset', 'string', 'CODE:ISSUER or native'], ['amount', 'i128', 'Amount']] },
  { slug: 'blend-supply', name: 'Blend: Supply collateral', intent: 'deposit', protocol: 'blend', kind: 'Chained',
    d: 'Approve and supply an asset as collateral to a Blend pool. Reserve index and b-token rate are read on-chain.',
    inputs: [['wallet', 'Address', 'Signer'], ['pool', 'Address', 'Blend pool'], ['asset', 'Address', 'Reserve asset'], ['amount', 'i128', 'Amount']] },
  { slug: 'blend-borrow', name: 'Blend: Borrow', intent: 'borrow', protocol: 'blend', kind: 'Single call',
    d: 'Borrow against supplied collateral. Health factor is simulated before the XDR is returned.',
    inputs: [['wallet', 'Address', 'Signer'], ['pool', 'Address', 'Blend pool'], ['asset', 'Address', 'Asset to borrow'], ['amount', 'i128', 'Amount']] },
  { slug: 'soroswap-swap-exact-in', name: 'Soroswap: Swap exact in', intent: 'swap', protocol: 'soroswap', kind: 'Single call',
    d: 'Multi-hop swap through the Soroswap router. The path is resolved from the pair registry for the given tokens.',
    inputs: [['wallet', 'Address', 'Signer'], ['tokenIn', 'Address', 'Sell token'], ['tokenOut', 'Address', 'Buy token'], ['amountIn', 'i128', 'Amount'], ['minOut', 'i128', 'Slippage guard']] },
  { slug: 'wxlm-mint', name: 'Wrapped XLM: Mint', intent: 'mint', protocol: 'wxlm', kind: 'Single call',
    d: 'Mint test wXLM on Testnet to any address. Admin auth is handled by the faucet key.',
    inputs: [['to', 'Address', 'Receiver'], ['amount', 'i128', 'Amount']] },
  { slug: 'tipjar-tip', name: 'Tip Jar: Tip', intent: 'transfer', protocol: 'tipjar', kind: 'Single call',
    d: 'Send a tip with a message. Used in the quickstart.',
    inputs: [['from', 'Address', 'Signer'], ['amount', 'i128', 'Amount'], ['memo', 'string', 'Message']] },
  { slug: 'escrow-release', name: 'Escrow: Release', intent: 'claim', protocol: 'escrow', kind: 'Single call',
    d: 'Release escrowed funds to the beneficiary. The arbiter and beneficiary are read from the escrow record.',
    inputs: [['arbiter', 'Address', 'Signer'], ['escrow', 'u64', 'Escrow id']] }
];

export const FLOW_BY_SLUG = Object.fromEntries(FLOWS.map((f) => [f.slug, f]));
export const INTENTS = ['all', ...new Set(FLOWS.map((f) => f.intent))].sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b)));
export const PROTOCOLS = ['all', ...new Set(FLOWS.map((f) => f.protocol))].sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b)));

export const flowRequest = (f) => JSON.stringify({ inputs: Object.fromEntries(f.inputs.map(([k, t]) => [k, t === 'Address' ? 'G…' : t === 'bool' ? true : t === 'string' ? '…' : '0'])), network: 'testnet' }, null, 2);
export const flowCurl = (f) => `curl -X POST "${API_URL}/flows/${f.slug}/build" \\
  -H "Content-Type: application/json" \\
  -d '${flowRequest(f).replace(/\n\s*/g, ' ')}'

# -> { "xdr": "AAAAAgAAAADzKF2C…", "fee": "100", "signers": ["${f.inputs[0][0]}"] }`;
export const flowMcp = (f) => `run_flow({ flow: "${f.slug}", inputs: { ${f.inputs.map(([k]) => k).join(', ')} } })`;
