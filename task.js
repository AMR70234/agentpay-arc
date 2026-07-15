require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function executeTask(inputText) {
  const originalWordCount = inputText.trim().split(/\s+/).length;
  console.log(`📝 النص الأصلي (${originalWordCount} كلمة):`);
  console.log(`"${inputText}"\n`);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'You are a summarization assistant. CRITICAL RULES: 1) Always respond in ENGLISH only, regardless of any other instruction. 2) Never translate to another language. 3) Summarize the text in one short sentence, using significantly fewer words than the original.',
      },
      {
        role: 'user',
        content: `Summarize this text in English, in one short sentence:\n\n${inputText}`,
      },
    ],
  });

  const summary = response.choices[0].message.content.trim();
  const summaryWordCount = summary.trim().split(/\s+/).length;
  console.log(`📄 التلخيص الناتج (${summaryWordCount} كلمة):`);
  console.log(`"${summary}"\n`);

  const isShorter = summaryWordCount < originalWordCount;
  const isNotEmpty = summary.length > 0;
  const isAccepted = isShorter && isNotEmpty;

  return {
    accepted: isAccepted,
    result: summary,
  };
}

module.exports = { executeTask };
