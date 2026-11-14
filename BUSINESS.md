# Business case

This page separates **what exists today** (a working testnet product) from **opportunity** (what it could
become). There are no customers, revenue or partnerships yet; nothing below claims otherwise.

## The problem

AI agents are starting to buy things for people. Juniper Research forecasts agentic-commerce transaction
value to grow from about **$8 bn in 2026 to $3.5 tn in 2031**
([Juniper Research, 2026](https://www.juniperresearch.com/research/fintech-payments/ecommerce/agentic-commerce-research-report/)).
McKinsey calls it a shift in how consumers and merchants transact
([McKinsey, 2025](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants)).

The risk is that the agent *decides* the payment, and agents can be talked into things:

* The U.S. Payments Forum names **prompt injection "the new fraud vector"** for agentic commerce
  ([USPF white paper, 2026, §5.2](https://www.uspaymentsforum.org/wp-content/uploads/2026/07/USPF-Agentic-Commerce_A-Primer-for-the-Payments-Industry-White-Paper.pdf)).
* J.P. Morgan: *"A prompt expresses intent; it does not enforce authority"*: payment agents need enforceable
  controls ([J.P. Morgan, 2026](https://www.jpmorgan.com/payments/newsroom/ai-agent-controls-payments)).
* Deloitte expects fraud in agentic commerce to grow sharply
  ([Deloitte, 2026](https://www.deloitte.com/content/dam/assets-zone3/us/en/docs/industries/financial-services/2026/bcm-fraud-in-agentic-commerce.pdf)).
* OWASP ranks prompt injection the #1 risk for LLM applications
  ([OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)).
* A reported 2026 incident: hidden instructions in a public post led an AI-linked wallet to send $175,000
  ([BeInCrypto, Nov 2026](https://beincrypto.com/ai-agent-payments-banking-adoption-risks/)).

## Why existing approaches fall short

| Approach | Examples | What it doesn't do |
| --- | --- | --- |
| Agent payment rails / protocols | Visa Intelligent Commerce ([Visa](https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22276.html)), Mastercard Agent Pay ([Mastercard](https://www.mastercard.com/news/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai)), Google AP2 ([Google](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)), Stripe/OpenAI ACP ([Stripe](https://stripe.com/newsroom/news/stripe-openai-instant-checkout)), Coinbase x402 ([Coinbase](https://www.coinbase.com/developer-platform/discover/launches/x402)) | They move money and carry mandates; they don't check that *this item at this price* is what the merchant actually offers. |
| Agent wallets with spending limits | Crossmint agentic wallets ([Crossmint](https://www.crossmint.com/products/agentic-wallets)), Skyfire ([TechCrunch](https://techcrunch.com/2024/08/21/skyfire-lets-ai-agents-spend-your-money/)) | A limit says "anything under $10". It can't tell a $4.50 latte from a $9.99 "refund fee" a menu talked the model into. |
| Prompt guardrails | system prompts, classifiers | Probabilistic, and they run where the attacker's text runs. |

## Tally's approach

Tally is the **control layer** between an agent and any rail: a payment is valid only for an item the merchant
signed, at the signed price, to the merchant's registered account, inside rules only the owner can change,
and the NEAR contract enforces it. Price fairness is provable (merchants certify the cheapest price per
category and are slashed if their own signed menu contradicts it). Anything unusual waits for the owner.

**What makes it defensible:** the merchant-signed catalog commitment and its on-chain verification; the
key-level separation between agent, owner and relayer; the slashable merchant bond and DAO arbitration;
and the verification artifacts (TEE attestation, portable MPC-signed receipts) that let third parties trust
a Tally receipt without trusting Tally.

## Customers (target segments)

| Segment | Job to be done | Why Tally |
| --- | --- | --- |
| Families sending allowances (incl. cross-border) | "My kid / parent can spend this on food and transit, nothing else" | category rules, Second Look, family top-ups; remittances still cost ~6.36% on average ([World Bank RPW, Q3 2025](https://remittanceprices.worldbank.org/)) |
| Agent developers (MCP / NEAR AI / Agent Market) | let an agent pay for things without holding a real key | pay-only key, gasless relay, MCP tools, SDK |
| Merchants and canteens | accept agent payments without chargeback ambiguity | signed menus, bonded reputation, portable receipts |
| Employers / expense programs | per-employee agent budgets with merchant allow-lists | rules + Guard + receipts |

## Revenue model (proposed)

* **Merchant fee:** a small percentage on settled agent purchases (charged in the contract on payout).
* **Relayer / gas sponsorship as a service:** owners or platforms pay for gasless agent payments.
* **Verification API:** Tally Guard reports on the Agent Market (live today at $1 per check, no sales yet).
* **Enterprise policy tier:** managed rule templates, DAO arbitration, audit exports.

## Go-to-market

1. Developer-first: SDK + MCP server so agent builders adopt Tally as the "pay safely" tool.
2. NEAR ecosystem: Agent Market listing, NEAR AI Cloud agents, wallet sign-in for existing users.
3. Pilot one closed loop (a campus canteen or co-working café) where merchants and payers are known.

## Costs and scalability

Per purchase, one NEAR transaction plus a token transfer (fractions of a cent in gas on NEAR); storage is
bounded per owner (see SECURITY.md TAL-02/03). The app runs on Cloudflare Workers. At scale, history views
move to an indexer and rate limits to Durable Objects.

## Risks

Regulatory treatment of stablecoin payments and stored balances; merchant onboarding (cold start);
dependence on agent platforms adopting a control layer; no independent audit yet.

See [ROADMAP.md](ROADMAP.md) for what comes next.
