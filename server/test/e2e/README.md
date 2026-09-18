# e2e

Needs a `.env.test` (git-ignored) in `server/` with `E2E_CONTRACT_ID` and `E2E_SECRET_KEY` for a funded testnet account that owns the deployed kitchen-sink fixture.

Run with `npm run test:e2e` (excluded from `npm test`; talks to real testnet RPC).

If the contract expires or the account runs dry (testnet resets quarterly), redeploy with the Step-1 commands from the Task 12 brief:

```bash
cd server/test/fixtures/kitchen-sink
stellar keys generate sonata-e2e --network testnet --fund      # friendbot-funded; add --overwrite to replace an existing key
stellar contract deploy --wasm kitchen_sink.wasm --source-account sonata-e2e --network testnet
stellar keys show sonata-e2e                                    # secret key
```
