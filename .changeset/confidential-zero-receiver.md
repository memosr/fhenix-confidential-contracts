---
"fhenix-confidential-contracts": patch
---

Reject `address(0)` as the receiver of `ERC20ConfidentialLib.confidentialMint` and `ERC20ConfidentialLib.shieldTo`.

Neither function checked its receiver, unlike `FHERC20Core._mint`:

- `confidentialMint(address(0), x)` minted `x` public backing into `CONFIDENTIAL_POOL` while the confidential credit landed on no account. The backing was owned by nobody and could never be unshielded, yet it counted toward `confidentialTotalSupply`.
- `shieldTo(address(0), x)` passed the zero receiver into the `from` slot of the self-only `__ledger` bridge, which reads a zero `from` as a MINT. The "move `to`'s tokens into the pool" leg therefore created `x` public supply out of nothing.

Both now revert with `ConfidentialInvalidReceiver(address(0))`. `autoShield` stays best-effort and returns early for a zero receiver instead of reverting. No selector or storage change.
