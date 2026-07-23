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
        content: 'You are an independent, skeptical verifier, separate from whatever system produced this answer. Judge it against TWO rules, in any language: (1) reject if it is a refusal, apology, statement of not knowing, or vague redirection instead of answering; (2) reject if it states a specific fact about something that changes over time (current officeholders, prices, rankings, recent events) WITHOUT a caveat that it may be outdated. Respond with only YES (passes both rules) or NO (fails either rule).',
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

async function doQA(inputText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: 'Answer the question directly and concisely, in the SAME language as the question, in one or two sentences. If you genuinely cannot answer, say so clearly and briefly. If the question is about something that changes over time (current officeholders, prices, rankings, recent events), you MUST include a brief caveat that your information may be outdated.' },
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
