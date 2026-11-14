# Shared helpers. Full-access keys live in ~/.near-credentials (legacy keychain), never in this repo.
set -euo pipefail
PREFIX="${PREFIX:-tallynear}"
CONTRACT="${CONTRACT:-$PREFIX.testnet}"
TOKEN="$PREFIX-usdc.testnet"
ARBITER="$PREFIX-arbiter.testnet"
OWNER="$PREFIX-alice.testnet"     # capsule owner whose agent pays
OWNER2="$PREFIX-bob.testnet"      # second owner, files counterparty reports
MERCHANT="$PREFIX-cafe.testnet"   # honest merchant
SHADY="$PREFIX-shady.testnet"     # merchant the arbiter blocklists for the attack demo
NET=(network-config testnet)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# call <signer> <contract> <method> <json> [deposit]
call() {
  near contract call-function as-transaction "$2" "$3" json-args "$4" \
    prepaid-gas '100.0 Tgas' attached-deposit "${5:-0 NEAR}" \
    sign-as "$1" "${NET[@]}" sign-with-legacy-keychain send
}
view() {
  near contract call-function as-read-only "$1" "$2" json-args "$3" "${NET[@]}" now
}
exists() {
  curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    grep -q '"amount"'
}
