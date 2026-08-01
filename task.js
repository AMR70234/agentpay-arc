require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function classifyTask(inputText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'Classify the following text into exactly one category: "summarize" (long descriptive text to condense), "sentiment" (opinion/review text to analyze), or "qa" (a direct question to answer). Respond with only the single word category, nothing else.',
      },
      { role: 'user', content: inputText },
    ],
  });
  const category = response.choices[0].message.content.trim().toLowerCase();
  if (['summarize', 'sentiment', 'qa'].includes(category)) return category;
  return 'summarize';
}

async function doSummarize(inputText) {
  const originalWordCount = inputText.trim().split(/\s+/).length;
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: 'Summarize in the SAME language as the input, in one short sentence, using significantly fewer words than the original.' },
      { role: 'user', content: `Summarize this text, in one short sentence:\n\n${inputText}` },
    ],
  });
  const summary = response.choices[0].message.content.trim();
  const summaryWordCount = summary.trim().split(/\s+/).length;
  const accepted = summaryWordCount < originalWordCount && summary.length > 0;
  return { accepted, result: summary, taskType: 'summarize' };
}

async function doSentiment(inputText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: 'Analyze the sentiment of the text. Respond in this exact format: "Sentiment: <Positive/Negative/Neutral> — <one short reason, under 12 words>".' },
      { role: 'user', content: inputText },
    ],
  });
  const result = response.choices[0].message.content.trim();
  const accepted = /^Sentiment: (Positive|Negative|Neutral)/.test(result);
  return { accepted, result, taskType: 'sentiment' };
}

// AI-based check: is this a genuine answer, or a refusal/non-answer, in ANY language?
// Independent verifier — uses a SEPARATE, stronger model (gpt-4o) than the one
// that executed the task (gpt-4o-mini), so no model grades its own work.
async function isGenuineAnswer(question, answer) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You are an independent, skeptical verifier, separate from whatever system produced this answer. Judge it against TWO rules, in any language: (1) reject if it is a refusal, apology, statement of not knowing, or vague redirection instead of answering; (2) reject if it states a specific fact about something that changes over time (current officeholders, prices, rankings, ongoing/future events) WITHOUT a caveat that it may be outdated. Do NOT apply rule 2 to well-established historical facts (past events with a fixed, known date, like a company's IPO date or founding date) — those don't need a caveat. Respond with only YES (passes both rules) or NO (fails either rule).\n\n${ARC_CONTEXT}\n${CIRCLE_CONTEXT}`,
      },
      {
        role: 'user',
        content: `Question: ${question}\n\nAnswer: ${answer}\n\nDoes the answer genuinely answer the question? Respond YES or NO only.`,
      },
    ],
  });
  const verdict = response.choices[0].message.content.trim().toUpperCase();
  return verdict.startsWith('YES');
}

const ARC_CONTEXT = `Background knowledge about Arc (use this if the question is about Arc blockchain):
Arc is Circle's Layer-1 blockchain, marketed as "the Economic OS for the internet" — a public, sovereign L1 (not an Ethereum Layer-2) purpose-built for stablecoin-native finance. Arc is built and operated by Circle Technology Services, LLC (a Circle Internet Group subsidiary); it is not an independent startup with separate named founders — it is a Circle-developed network. It uses USDC as its native gas token (no separate volatile token needed for fees), offers deterministic sub-second settlement finality, is EVM-compatible, and supports opt-in configurable privacy for compliance. Cross-chain transfers go through Circle's CCTP, and it integrates with Circle Gateway, institutional on/offramps, and Circle Payments Network (CPN).

As of mid-2026: Arc's public testnet launched in October 2025 and has processed over 240 million transactions with roughly 1.5 million active wallets. Mainnet is planned for summer 2026, though Circle has described the exact timing and native token launch as still in an "exploration phase." A separate ARC token is planned with a 10 billion initial supply (60% ecosystem, 25% Circle, 15% long-term reserves), but it is not live yet — USDC remains the only gas token today. Institutional partners cited by Circle include Goldman Sachs, Mastercard, and Visa.
`;

const CIRCLE_CONTEXT = `Background knowledge about Circle (use this if the question is about Circle the company):
Circle Internet Group is the company behind USDC, the second-largest stablecoin by market cap, fully backed 1:1 by cash and short-term US Treasuries, redeemable at par. Circle also operates Circle Mint (issuance/redemption), Circle Payments Network (CPN, for institutional cross-border settlement), CCTP (Cross-Chain Transfer Protocol, for native USDC transfers across chains without wrapped tokens), Circle Gateway, and the App Kit SDK (Send/Bridge/Swap). Circle went public on the NYSE in June 2025. Circle also builds Arc, its own Layer-1 blockchain (see above).
`;

const GETTING_STARTED_CONTEXT = `Practical steps for building on Arc (use this if the question asks HOW to do something, not just what Arc is):
To deploy a contract on Arc Testnet: (1) Create a Circle Developer-Controlled Wallet so your backend can programmatically sign transactions, (2) Fund it with testnet USDC via Circle's faucet — Arc Testnet uses USDC as gas, so you need a balance before any transaction, (3) Deploy your Solidity contract (or use a Circle Contracts template for common patterns like ERC-20), (4) Verify the deployment and transaction status via the transaction ID.
To connect to Arc: use the RPC endpoint and chain ID from docs.arc.io's network configuration page, or a provider like QuickNode which supports Arc directly.
Reference docs to point users to: docs.arc.io (main developer docs, includes quickstarts, tutorials, and an /llms.txt index of all pages), developers.circle.com (Circle's own API/SDK docs for Wallets, Contracts, Gateway, CCTP), and community.arc.io (community guides and quickstart spotlights).
`;

async function doQA(inputText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: `Answer the question directly and concisely, in the SAME language as the question, in one or two sentences. If you genuinely cannot answer, say so clearly and briefly. If the question is about something that changes over time (current officeholders, prices, rankings, recent events), you MUST include a brief caveat that your information may be outdated.\n\n${ARC_CONTEXT}\n${CIRCLE_CONTEXT}\n${GETTING_STARTED_CONTEXT}` },
      { role: 'user', content: inputText },
    ],
  });
  const result = response.choices[0].message.content.trim();
  const genuine = await isGenuineAnswer(inputText, result);
  const accepted = result.length > 0 && result.length < 500 && genuine;
  return { accepted, result, taskType: 'qa' };
}

async function executeTask(inputText, manualType) {
  const taskType = manualType || await classifyTask(inputText);
  console.log(`🧭 Task classified as: ${taskType}`);

  let result;
  if (taskType === 'sentiment') result = await doSentiment(inputText);
  else if (taskType === 'qa') result = await doQA(inputText);
  else result = await doSummarize(inputText);

  console.log(`📄 Result: "${result.result}"`);
  return result;
}

module.exports = { executeTask, classifyTask };
