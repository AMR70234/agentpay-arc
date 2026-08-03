# AgentPay

**Autonomous agent-to-agent settlement on Arc, powered by USDC — with real escrow, automatic task classification, and on-chain reputation.**

AgentPay is a working prototype for the *Agentic Economy* track of the Programmable Money Hackathon. It demonstrates a client agent and a worker agent transacting value with no human in the loop: the client escrows a fee, the worker classifies and completes the task, and payment in USDC settles — or refunds — on Arc the instant the result is verified.

## The problem

Autonomous agents are increasingly able to act on behalf of users — managing resources, completing tasks, and coordinating with other agents. But most "agent economies" today still route payment through a human: an invoice, an approval step, a manual transfer. That breaks the promise of autonomy and doesn't scale to machine-speed, usage-based commerce. And a simple "pay on completion" model doesn't protect either side: the client has no guarantee of quality, and the worker has no guarantee of payment.

## What AgentPay does

1. A **client agent** submits any task — a passage, a review, a question — with no need to specify what kind of task it is.
2. The **worker agent autonomously classifies** the task (summarization, sentiment analysis, or question-answering) and prices the fee dynamically based on task length.
3. The fee is **escrowed** in a dedicated smart contract wallet — held in trust, not sent directly to the worker.
4. The **worker agent executes** the task using an LLM (gpt-4o-mini).
5. The result is **verified against type-specific acceptance rules** — for example, a summary must be genuinely shorter than the source, and a question answer is rejected if the model admits it doesn't actually know (no vague "check another source" non-answers get paid).
6. If accepted, the **escrow releases** the fee to the worker on **Arc**, Circle's stablecoin-native L1, in seconds. If rejected, the **escrow refunds** the client automatically.
7. Every completed job updates the worker's **on-chain-adjacent reputation record** — total jobs, accepted, and acceptance rate — visible to anyone deciding whether to trust this worker.

Every step is real: real wallets, a real LLM call, real escrow, and real on-chain USDC transfers — not a simulation.

## Recent hardening

Two additions on top of the base flow, ported from lessons learned in a related security-focused fork of this project:

- **Independent verification.** The worker executes tasks with `gpt-4o-mini`, but a *separate*, stronger model (`gpt-4o`) independently judges whether the result is genuine — rather than the same model grading its own work. It also rejects confident-sounding answers about time-sensitive facts (current officeholders, prices, rankings) unless they include an explicit "may be outdated" caveat.
- **Dispute window.** Accepted jobs no longer release instantly. Funds sit in escrow for an 8-second window during which the client can dispute the result via `POST /dispute` and get refunded before the automatic release timer fires.

## On-chain escrow (smart contract)

Escrow logic runs on `AgentPayEscrow.sol`, deployed on Arc Testnet via Circle's Smart Contract Platform — built on OpenZeppelin's audited primitives (ReentrancyGuard, Ownable, Pausable). `escrowJob.js` calls the contract's functions (`createJob`, `release`, `dispute`) directly through Circle's Contract Execution API, rather than moving funds through a raw wallet-to-wallet transfer. The contract's owner was set explicitly at deploy time to the client wallet, avoiding a known pitfall where Circle's own deployer address ends up as the on-chain owner by default.

## Why Arc + USDC

- **USDC as native gas** means the agents never need to hold or manage a separate volatile asset just to pay network fees.
- **Sub-second finality** makes agent-to-agent payment practical at the speed agents actually operate — no waiting on confirmation blocks before escrow can release or refund.
- **Circle's Developer-Controlled Wallets SDK** lets each agent — client, escrow, and worker — hold and control its own wallet programmatically, which is what makes autonomous multi-party settlement possible in the first place.

## Architecture
┌─────────────┐        POST /run-job        ┌──────────────┐
│   Frontend   │ ───────────────────────────▶│   Backend     │
│ (index.html) │◀─────────────────────────── │ (Express API) │
└─────────────┘        JSON response          └──────┬───────┘
│
┌──────────────────────────────┼──────────────────────────────┐
▼                              ▼                              ▼
┌───────────────┐            ┌──────────────────┐            ┌────────────────┐
│   task.js      │            │  escrowJob.js     │            │  reputation.js  │
│ classify +     │◀───────────│  orchestrates     │───────────▶│  tracks accept/  │
│ execute + rule │            │  the full flow    │            │  reject history  │
└───────────────┘            └─────────┬─────────┘            └────────────────┘
│
▼
┌───────────────────────────┐
│      Arc Testnet           │
│  Client ──▶ Escrow          │
│  Escrow ──▶ Worker (accept) │
│  Escrow ──▶ Client (refund) │
└───────────────────────────┘

## The escrow flow in detail
Client Agent  ──1. escrow fee──▶  Escrow Wallet
│
2. worker executes task
│
┌──────────────┴──────────────┐
▼                              ▼
accepted                        rejected
│                              │
3a. release to Worker           3b. refund to Client

## Task classification & acceptance rules

| Task type | How it's detected | Acceptance rule |
|---|---|---|
| **Summarize** | Long descriptive passage | Summary must be genuinely shorter than the source and non-empty |
| **Sentiment** | Opinion/review text | Must return a valid Positive/Negative/Neutral classification with a reason |
| **Q&A** | A direct question | Must give a real answer — rejected if the model admits it can't answer (no real-time data, no specific info, etc.) |

The client never tells the worker which type of task it's submitting — the worker agent decides that itself, autonomously.

## Dynamic pricing

Fees aren't fixed. The worker prices each job based on task length:

| Task length | Fee |
|---|---|
| ≤ 20 words | 0.5 USDC |
| 21–60 words | 1 USDC |
| 60+ words | 2 USDC |

## Tech stack

| Layer | Technology |
|---|---|
| Wallets & settlement | Circle Developer-Controlled Wallets SDK + Contract Execution API |
| Blockchain | Arc Testnet |
| Task execution | OpenAI (gpt-4o-mini) |
| Backend | Node.js, Express |
| Frontend | HTML/CSS/JS (no framework) |

## Project structure
agentic-hackathon-project/
├── circleClient.js     # Shared Circle SDK client (API key + entity secret)
├── task.js             # Autonomous classification + type-specific execution & acceptance rules
├── escrowJob.js         # Orchestrates the full escrow → execute → release/refund flow
├── reputation.js        # Tracks worker job history and acceptance rate
├── server.js            # Express API: /run-job, /balances, /reputation
├── public/
│   └── index.html      # Frontend: task input, live settlement log, 3-wallet balances, reputation, history
└── .env                 # API keys and wallet IDs (not committed)

## Running it locally

```bash
npm install
node server.js
```

Then open `http://localhost:3001`.

Required environment variables (`.env`):
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
WALLET_ID=
WALLET_ADDRESS=
ESCROW_WALLET_ID=
ESCROW_WALLET_ADDRESS=
WORKER_WALLET_ID=
WORKER_WALLET_ADDRESS=
OPENAI_API_KEY=

## What's next

- Move escrow logic from an off-chain orchestration script into an actual on-chain smart contract, closer to the ERC-8183 job/escrow standard (post → escrow → deliver → evaluate → settle entirely on-chain).
- Add on-chain agent identity (ERC-8004), so a worker agent's reputation is portable and verifiable across applications, not stored in a local file.
- Persist reputation data in a hosted store so it survives redeploys, instead of local JSON.

## Live demo

- **App:** https://agentpay-arc-97rj.onrender.com
- **Repo:** https://github.com/AMR70234/agentpay-arc

## Team

Built for the Programmable Money Hackathon (Arc × Encode Club), Agentic Economy track.

## Independent infrastructure

All wallets (client, escrow, worker 1, worker 2) and the deployed smart contract are fully independent of any other project — created from scratch, funded separately, with the contract owner explicitly set to the client wallet at deploy time to avoid a common pitfall where Circle's own deployer address ends up as the on-chain owner by default.

## Reliability: keep-alive ping

The server pings itself every 5 minutes to reduce cold-start delays on Render's free tier, keeping the live demo responsive for visitors instead of making them wait through a 30-60 second wake-up on the first request.

## Multi-worker competition

Two independent worker agents, each with its own wallet and its own wallet-linked reputation record. Before creating a job, the client agent scores each worker on a combination of acceptance rate and price, and picks the winner — a real decision, not a fixed assignment. Every job records its outcome against the specific worker that handled it, so reputations diverge naturally as each worker builds its own track record. The smart contract itself required zero changes; it already accepts any worker address as a parameter.

## Circle Gateway Nanopayments — live and verified

Explored Circle's Nanopayments (built on Circle Gateway, using the x402 protocol and EIP-3009 signed authorizations) as a way to move toward sub-cent, per-step payments. Went beyond exploration: approved USDC to the official GatewayWallet contract on Arc Testnet (`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, confirmed against Arc's own docs), deposited 1 USDC, and confirmed the balance via Circle's Gateway API (`gateway-api-testnet.circle.com`).

A real, funded Gateway balance now exists for this project on Arc. Went further: added a live, working Nanopayments-protected endpoint (`GET /priority-status`), using Circle's official `@circle-fin/x402-batching` Express middleware. Calling it without payment returns a genuine HTTP 402 with a full x402 payment payload — verified directly via curl, not simulated.

The full buyer-side payment flow is also live and verified: a dedicated raw wallet (separate from Circle's Developer-Controlled Wallets, since GatewayClient requires a raw private key) deposited USDC into Gateway, signed an EIP-3009 authorization, and successfully paid for the protected endpoint — receiving a real `200 OK` with the priority-access response. Getting here required routing around Arc Testnet's public RPC rate limits (via a third-party Alchemy endpoint, as Arc's own docs recommend for high-throughput use) and explicitly setting `facilitatorUrl: 'https://gateway-api-testnet.circle.com'` and `networks: ['eip155:5042002']`, since the default facilitator only lists mainnet chains.

## Static analysis: Slither

Ran Slither directly against `AgentPayEscrow.sol`. Result: no critical or high-severity findings. Flagged items were standard-severity notes — a reentrancy warning already mitigated by OpenZeppelin's `ReentrancyGuard`, and timestamp-based comparisons that are an accepted pattern for dispute windows measured in minutes, not something meaningfully exploitable at that granularity.

## Sidebar redesign and personal Google-linked wallets

The homepage and all seven pages were redesigned with a left-sidebar navigation and a distinct blue theme, separate from the teal palette used in the companion AgentGuard project.

Visitors can optionally sign in with Google. On first sign-in, a dedicated Circle wallet is created automatically on Arc Testnet and permanently linked to that Google account — signing in again always returns the same wallet, balance, and history. Signed-in users see a first-time welcome modal, and their own wallet address/balance override the shared demo client card, with no visual flash of the wrong balance during the swap.

Data isolation: the Transactions page and Reputation page filter to only the signed-in user's own jobs when logged in, with a dedicated "Your record, as a client" section on Reputation showing personal job stats.

## Agent Stack-powered wallet funding, rate-limited per account

A "Fund via Agent Stack" button lets signed-in users request test USDC directly from the Circle Agent Stack CLI wallet, capped at $10/day per Google account (tracked per-account, separate from the shared escrow spend). If the Agent Stack wallet itself runs low, the server automatically refills it from Circle's testnet faucet and retries the transfer once before surfacing an error — the same one-time auto-rescue pattern used for the escrow flow itself.

## Dispute window: explicit button disable, not just visual hide

The dispute button is now explicitly disabled the moment the countdown reaches zero, in addition to the countdown bar hiding — a defense-in-depth fix ensuring the button can never trigger a dispute after the window has genuinely closed, matching the on-chain contract's own deadline check.
