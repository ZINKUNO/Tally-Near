#!/usr/bin/env bash
# Creates faucet-funded testnet accounts, builds both contracts and deploys them.
# Usage: PREFIX=yourname ./scripts/deploy.sh   (re-runnable; existing accounts are kept)
source "$(dirname "$0")/common.sh"

for acc in "$OWNER2" "$CONTRACT" "$TOKEN" "$ARBITER" "$OWNER" "$MERCHANT" "$SHADY"; do
  exists "$acc" && continue
  near account create-account sponsor-by-faucet-service "$acc" \
    autogenerate-new-keypair save-to-legacy-keychain "${NET[@]}" create ||
    # faucet rate-limited: fund the account from one created earlier in this loop
    near account create-account fund-myself "$acc" '3 NEAR' autogenerate-new-keypair \
      save-to-legacy-keychain sign-as "$OWNER2" "${NET[@]}" sign-with-legacy-keychain send
  sleep 2
done

(cd "$ROOT/contracts/tally" && cargo near build non-reproducible-wasm)
(cd "$ROOT/contracts/tusdc" && cargo near build non-reproducible-wasm)

view "$TOKEN" ft_metadata '{}' >/dev/null 2>&1 || near contract deploy "$TOKEN" use-file "$ROOT/target/near/tusdc/tusdc.wasm" \
  with-init-call new json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
  "${NET[@]}" sign-with-legacy-keychain send

if view "$CONTRACT" get_config '{}' >/dev/null 2>&1; then
  near contract deploy "$CONTRACT" use-file "$ROOT/target/near/tally/tally.wasm" without-init-call \
    "${NET[@]}" sign-with-legacy-keychain send
else
  near contract deploy "$CONTRACT" use-file "$ROOT/target/near/tally/tally.wasm" \
    with-init-call new json-args "{\"arbiter\":\"$ARBITER\",\"token\":\"$TOKEN\"}" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
    "${NET[@]}" sign-with-legacy-keychain send
fi

# The contract must hold a token account to receive capsule funding.
call "$CONTRACT" "$TOKEN" mint '{"amount":"0"}'
echo
echo "Deployed Tally at $CONTRACT (token $TOKEN). Next: PREFIX=$PREFIX pnpm --filter @tally-near/demo seed"
echo
echo "For the app, set web/lib/deployments.json to:"
echo "  {\"network\":\"testnet\",\"tally\":\"$CONTRACT\",\"token\":\"$TOKEN\",\"demoMerchant\":\"$MERCHANT\",\"sponsor\":\"<a funded account>\"}"
echo "and in web/.env.local: DEMO_MERCHANT_SIGNER_KEY=<cafeMenu from ~/.tally/$PREFIX/keys.json>, SPONSOR_ACCOUNT, SPONSOR_KEY"
