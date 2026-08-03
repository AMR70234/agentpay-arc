# AgentPay
**Autonomous agent-to-agent settlement on Arc, powered by USDC — with real escrow, automatic task classification, and on-chain reputation.**

AgentPay is a working prototype for the *Agentic Economy* track of the Programmable Money Hackathon. It demonstrates a client agent and a worker agent transacting value with no human in the loop: the client escrows a fee, the worker classifies and completes the task, and payment in USDC settles — or refunds — on Arc the instant the result is verified.

## The problem

Autonomous agents are increasingly able to act on behalf of users — managing resources, completing tasks, and coordinating with other agents. But most "agent economies" today still route payment through a human: an invoice, an approval step, a manual transfer. That breaks the promise of autonomy and doesn't scale to machine-speed, usage-based commerce. And a simple "pay on completion" model doesn't protect either side: the client has no guarantee of quality, and the worker has no guarantee of payment.

## How it works

1. A **client agent** submits any task — a passage, a review, a question — with no need to specify what kind of task it is.
2. The **worker agent autonomously classifies** the task (summarization, sentiment analysis, or question-answering) and prices the fee dynamically based on task length.
3. The client agent **picks a worker**, scoring the two competing worker agents on price and wallet-linked reputation — a real decision, not a fixed assignment.
4. The fee is **escrowed on-chain** in `AgentPayEscrow.sol` (deployed on Arc Testnet, built on OpenZeppelin's audited primitives), signed via Circle's Contract Execution API — not a raw wallet-to-wallet transfer.
5. The **worker agent executes** the task using an LLM (`gpt-4o-mini`).
6. A **separate, independent model** (`gpt-4o`) verifies the result against type-specific acceptance rules — no model grades its own work. It also rejects confident-sounding answers about time-sensitive facts unless they carry an explicit "may be outdated" caveat.
7. Accepted jobs enter an **8-second dispute window** before funds auto-release — the client can dispute and get refunded instead.
8. Every completed job updates the worker's **wallet-linked reputation record** — total jobs, accepted, and acceptance rate.

Every step is real: real wallets, real LLM calls, real on-chain escrow, and real USDC settlement on Arc Testnet — not a simulation.

**Task classification & acceptance rules**

| Task type | How it's detected | Acceptance rule |
|---|---|---|
| **Summarize** | Long descriptive passage | Summary must be genuinely shorter than the source and non-empty |
| **Sentiment** | Opinion/review text | Must return a valid Positive/Negative/Neutral classification with a reason |
| **Q&A** | A direct question | Must give a real answer — rejected if the model admits it can't answer |

The client never tells the worker which type of task it's submitting — the worker agent decides that itself, autonomously.

**Dynamic pricing**

| Task length | Fee |
|---|---|
| ≤ 20 words | 0.5 USDC |
| 21–60 words | 1 USDC |
| 60+ words | 2 USDC |

## Core features

**Multi-worker competition.** Two independent worker agents, each with its own wallet and wallet-linked reputation record. The client scores each worker on acceptance rate and price before every job. The smart contract required zero changes to support this — it already accepts any worker address as a parameter.

**Circle Agent Stack.** A real agent-controlled wallet, created via `circle wallet create --blockchain ARC-TESTNET` and funded with real testnet USDC. It executes live on-chain USDC payments (verifiable on Arc Explorer) and acts as a self-healing fallback: if the client wallet's USDC approval ever fails, the server automatically pulls a rescue transfer from the Agent Stack wallet and retries once — no manual intervention needed.

**Circle Gateway Nanopayments.** A live, working Nanopayments-protected endpoint (`GET /priority-status`) using Circle's official `@circle-fin/x402-batching` middleware. Paying the $0.001 priority fee triggers a real EIP-3009-signed transaction that shortens the escrow dispute window from 8 seconds to 1. Getting this live required explicitly setting `facilitatorUrl` and the correct Arc network ID (`eip155:5042002`), since the default facilitator only lists mainnet chains, plus routing around Arc's public RPC rate limits via a dedicated provider.

**Personal Google-linked wallets.** Visitors can optionally sign in with Google. On first sign-in, a dedicated Circle wallet is created automatically on Arc Testnet and permanently linked to that account — signing in again always returns the same wallet, balance, and history. Signed-in users see a first-time welcome modal, and the Transactions and Reputation pages filter to their own jobs only, with a dedicated "Your record, as a client" section.

**Rate-limited wallet funding.** A "Fund via Agent Stack" button lets signed-in users request test USDC directly from the Agent Stack wallet, capped at $10/day per Google account. If the Agent Stack wallet itself runs low, the server auto-refills it from Circle's testnet faucet and retries once.

## Security

- **On-chain escrow.** Funds are held by `AgentPayEscrow.sol`, deployed on Arc Testnet via Circle's Smart Contract Platform — not the app server. Built on OpenZeppelin's audited primitives (ReentrancyGuard, Ownable, Pausable). The contract owner was set explicitly at deploy time to the client wallet, avoiding a known pitfall where Circle's own deployer address ends up as the on-chain owner by default.
- **Independent verification** and an **8-second dispute window**, explicitly disabled client-side the moment it expires — not just visually hidden — matching the contract's own on-chain deadline check.
- **Static analysis.** Ran Slither directly against the contract: no critical or high-severity findings. Flagged items were standard-severity notes — a reentrancy warning already mitigated by ReentrancyGuard, and timestamp-based comparisons accepted for dispute windows measured in minutes.
- **Independent infrastructure.** All wallets (client, escrow, worker 1, worker 2) and the deployed contract are fully independent of any other project, funded separately from scratch.

## Why Arc + USDC

- **USDC as native gas** means the agents never need to hold or manage a separate volatile asset just to pay network fees.
- **Sub-second finality** makes agent-to-agent payment practical at the speed agents actually operate.
- **Circle's Developer-Controlled Wallets SDK** lets each agent — client, escrow, and worker — hold and control its own wallet programmatically, which is what makes autonomous multi-party settlement possible in the first place.

## Architecture

┌─────────────┐ POST /run-job ┌──────────────┐
│ Frontend │ ───────────────────────────▶│ Backend │
│ (index.html) │◀─────────────────────────── │ (Express API) │
└─────────────┘ JSON response └──────┬───────┘
│
┌──────────────────────────────────┼──────────────────────────────┐
▼ ▼ ▼
┌───────────────┐ ┌──────────────────┐ ┌────────────────┐
│ task.js │ │ escrowJob.js │ │ reputation.js │
│ classify + │◀────────────────│ orchestrates │───────────▶│ tracks accept/ │
│ execute + rule │ │ the full flow │ │ reject history │
└───────────────┘ └─────────┬─────────┘ └────────────────┘
│
▼
┌───────────────────────────┐
│ Arc Testnet │
│ Client ──▶ Escrow │
│ Escrow ──▶ Worker (accept) │
│ Escrow ──▶ Client (refund) │
└───────────────────────────┘


## Tech stack

| Layer | Technology |
|---|---|
| Wallets & settlement | Circle Developer-Controlled Wallets SDK + Contract Execution API |
| Blockchain | Arc Testnet |
| Task execution | OpenAI (gpt-4o-mini + gpt-4o for verification) |
| Backend | Node.js, Express |
| Frontend | HTML/CSS/JS (no framework) |

## Project structure

agentic-hackathon-project/
├── circleClient.js # Shared Circle SDK client (API key + entity secret)
├── task.js # Autonomous classification + type-specific execution & acceptance rules
├── escrowJob.js # Orchestrates the full escrow → execute → release/refund flow
├── reputation.js # Tracks worker job history and acceptance rate
├── server.js # Express API: /run-job, /balances, /reputation, /auth/*
├── userWallets.js # Per-user Google-linked Circle wallet management
├── public/
│ └── index.html # Frontend: task input, live settlement log, wallet balances, reputation, history
└── .env # API keys and wallet IDs (not committed)


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
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=
USER_WALLET_SET_ID=


## Reliability

The server pings itself every 5 minutes to reduce cold-start delays on Render's free tier, keeping the live demo responsive instead of making visitors wait through a 30-60 second wake-up.

## What's next

- Move escrow logic from an off-chain orchestration script into an actual on-chain smart contract, closer to the ERC-8183 job/escrow standard (post → escrow → deliver → evaluate → settle entirely on-chain).
- Add on-chain agent identity (ERC-8004), so a worker agent's reputation is portable and verifiable across applications, not stored in a local file.
- Persist reputation data in a hosted store so it survives redeploys, instead of local JSON.

## Live demo

- **App:** https://agentpay-arc-97rj.onrender.com
- **Repo:** https://github.com/AMR70234/agentpay-arc

## Team

Built for the Programmable Money Hackathon (Arc × Encode Club), Agentic Economy track.
