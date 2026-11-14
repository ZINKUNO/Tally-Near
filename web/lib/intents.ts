/** NEAR Intents quotes and deposits live in the SDK so the app and the agent share one implementation. */
export {
  NEAR_USDC, ONECLICK, ORIGINS, depositRequest, parseDeposit, parseQuote, parseStatus, quoteRequest,
  type Deposit, type DepositStatus, type OriginId, type Quote,
} from "@tally-near/sdk";
