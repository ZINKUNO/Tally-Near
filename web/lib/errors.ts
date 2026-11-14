/** Contract and protocol errors in words a non-crypto user understands (no hashes, no "panic"). */
export const SENTENCES: Record<string, string> = {
  frozen: "Your allowance is paused.",
  expired: "This allowance has ended. Ask family to set up a new one.",
  unknown_merchant: "This counter isn't registered with Tally. Don't pay it.",
  merchant_inactive: "This counter isn't taking Tally right now.",
  guard_block: "Tally's Guard blocked this counter. It's on the shared blocklist or its bond was slashed.",
  bad_signature: "This menu wasn't signed by the counter. Don't pay it.",
  stale: "The menu refreshed. Scan again.",
  window_too_long: "This menu is too old to pay automatically.",
  not_on_menu: "That item or price is not on the signed menu.",
  category: "Your allowance can't be spent on this.",
  over_per_tx: "That's above your per-purchase limit.",
  over_daily: "That's above today's limit.",
  insufficient_balance: "Not enough left in your allowance.",
  duplicate: "Already paid. You won't be charged twice.",
  bad_args: "That payment was malformed, so nothing moved.",
  second_look: "This one needs your approval.",
  // NEAR protocol refusals for the agent's function-call key
  AccessKeyMethodNameMismatch: "Your agent's key can only pay. It can't do that.",
  AccessKeyReceiverMismatch: "Your agent's key only works with Tally.",
  RequiresFullAccess: "Your agent's key can't move money on its own.",
  NotEnoughAllowance: "Your agent has run out of fee allowance. Give it a new key in Settings.",
  NotEnoughBalance: "Not enough NEAR on this account for fees yet. Wait a moment and try again.",
  "already registered": "This counter is already open.",
  "attach at least min_bond NEAR": "You need a little more NEAR for the counter's bond.",
};

/** The reason code inside a refusal, a contract panic or a NEAR protocol error. */
export function errorName(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const o = e as { code?: string; message?: string; constructor?: { name?: string } };
  if (typeof o.code === "string" && SENTENCES[o.code]) return o.code;
  const text = `${o.constructor?.name ?? ""} ${o.message ?? ""}`;
  for (const k of Object.keys(SENTENCES)) {
    if (text.includes(k)) return k;
  }
  // contract panics look like "NotOnMenu: this item ..." (Debug name of the reject code)
  const m = /"?([A-Z][A-Za-z]+): /.exec(text);
  if (m) {
    const snake = m[1].replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (SENTENCES[snake]) return snake;
  }
  return undefined;
}

export function humanError(e: unknown): string {
  const name = errorName(e);
  if (name && SENTENCES[name]) return SENTENCES[name];
  return "That didn't go through, and nothing was charged. Try again.";
}
