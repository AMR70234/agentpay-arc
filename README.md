# AgentPay

**Autonomous agent-to-agent settlement on Arc, powered by USDC.**

AgentPay is a working prototype for the *Agentic Economy* track of the Programmable Money Hackathon. It demonstrates a client agent and a worker agent transacting value with no human in the loop: the client posts a task, the worker completes it with AI, and payment in USDC settles on Arc the instant the work is verified.

## The problem

Autonomous agents are increasingly able to act on behalf of users — managing resources, completing tasks, and coordinating with other agents. But most "agent economies" today still route payment through a human: an invoice, an approval step, a manual transfer. That breaks the promise of autonomy and doesn't scale to machine-speed, usage-based commerce.

## What AgentPay does

1. A **client agent** submits a task (in this prototype: summarize a piece of text) and escrows a fee in USDC.
2. A **worker agent** completes the task using an LLM (gpt-4o-mini).
3. The result is verified against an acceptance rule (the summary must be genuinely shorter than the source text and non-empty).
4. If accepted, the client agent's wallet pays the worker agent's wallet in USDC — settled on **Arc**, Circle's stablecoin-native L1, in seconds.
5. If rejected, no payment is made.

Every step is real: real wallets, a real LLM call, and a real on-chain USDC transfer — not a simulation.

## Why Arc + USDC

- **USDC as native gas** means the agents never need to hold or manage a separate volatile asset just to pay network fees.
- **Sub-second finality** makes agent-to-agent payment practical at the speed agents actually operate — no waiting on confirmation blocks before the next task can start.
- **Circle's Developer-Controlled Wallets** let each agent hold and control its own wallet programmatically, which is what makes "an agent that pays" possible in the first place.

## Architecture

```
┌─────────────┐        POST /run-job        ┌──────────────┐
│   Frontend   │ ───────────────────────────▶│   Backend     │
│ (index.html) │◀─────────────────────────── │ (Express API) │
└─────────────┘        JSON response          └──────┬───────┘
                                                       │
                                     ┌─────────────────┼─────────────────┐
                                     ▼                 ▼                 ▼
                              ┌───────────┐   ┌────────────────┐  ┌────────────┐
                              │  task.js   │   │ circleClient.js │  │  OpenAI    │
                              │ (accept /  │   │ (Circle SDK)    │  │  API       │
                              │  reject)   │   └────────┬───────┘  └────────────┘
                              └───────────┘             │
                                                         ▼
                                              ┌────────────────────┐
                                              │   Arc Testnet       │
                                              │ Client Wallet ──▶   │
                                              │  Worker Wallet      │
                                              └────────────────────┘
```

## Tech stack

| Layer | Technology |
|---|---|
| Wallets & settlement | Circle Developer-Controlled Wallets SDK |
| Blockchain | Arc Testnet |
| Task execution | OpenAI (gpt-4o-mini) |
| Backend | Node.js, Express |
| Frontend | HTML/CSS/JS (no framework) |

## Project structure

```
agentic-hackathon-project/
├── circleClient.js     # Shared Circle SDK client (API key + entity secret)
├── task.js             # Worker agent logic: summarize + accept/reject
├── server.js           # Express API: /run-job, /balances
├── public/
│   └── index.html      # Frontend: task input, live settlement log, balances, history
└── .env                # API keys and wallet IDs (not committed)
```

## Running it locally

```bash
npm install
node server.js
```

Then open `http://localhost:3001`.

Required environment variables (`.env`):
```
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
WALLET_ID=
WALLET_ADDRESS=
WORKER_WALLET_ID=
WORKER_WALLET_ADDRESS=
OPENAI_API_KEY=
```

## What's next

- Move from a single hardcoded task type to a general job-posting flow, closer to the ERC-8183 job/escrow pattern (post → escrow → deliver → evaluate → settle).
- Add on-chain agent identity and reputation (ERC-8004), so a worker agent's track record follows it across jobs.
- Support multiple worker agents competing for the same task, with the client agent choosing based on price and reputation.
- Move fee pricing from a fixed 1 USDC to a dynamic quote based on task complexity.

## Team

Built for the Programmable Money Hackathon (Arc × Encode Club), Agentic Economy track.
