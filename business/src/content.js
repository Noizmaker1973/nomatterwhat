// Generates the day's reflection with Claude. One API call per day serves every
// subscriber, so content cost stays flat no matter how many people subscribe.

const Anthropic = require('@anthropic-ai/sdk');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { z } = require('zod');
const config = require('./config');

const ReflectionSchema = z.object({
  title: z.string().describe('Short, warm title, under 8 words'),
  theme: z.string().describe('One of the 12 Steps, a slogan, or a recovery principle'),
  reading: z.string().describe('The reflection itself, 180-260 words, 2-4 paragraphs separated by blank lines'),
  action: z.string().describe('One concrete, small action for today, one sentence'),
  affirmation: z.string().describe('A first-person affirmation, one sentence'),
});

const SYSTEM_PROMPT = `You write a daily reflection email for people in recovery from alcohol and drug addiction (AA, NA and similar 12-step fellowships, plus people on other paths).

Voice: warm, plain-spoken, honest, never preachy. Speak like a sponsor with years of sobriety who still remembers early days. Avoid clichés stacked on clichés; one slogan, used well, is enough.

Rules:
- Ground each reflection in one recovery principle (a Step, a slogan such as "one day at a time", or a spiritual principle such as honesty, willingness, surrender, service, gratitude).
- Do not quote copyrighted literature (Big Book, Basic Text, Daily Reflections, Just for Today) verbatim. Paraphrase ideas in your own words.
- Do not give medical advice. Never suggest stopping or changing prescribed medication.
- Be inclusive: readers may be on day 1 or year 30, religious or not.
- Vary themes from day to day; the date is given so you can pick something fitting for the season or day of the week.`;

function dateLabel(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

async function generateReflection(date = new Date(), client = new Anthropic()) {
  const response = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(ReflectionSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Write the reflection for ${dateLabel(date)}.` }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Reflection request was declined: ${JSON.stringify(response.stop_details)}`);
  }
  if (!response.parsed_output) {
    throw new Error(`Reflection could not be parsed (stop_reason: ${response.stop_reason})`);
  }
  return { ...response.parsed_output, date: dateLabel(date) };
}

module.exports = { generateReflection, ReflectionSchema, dateLabel };
