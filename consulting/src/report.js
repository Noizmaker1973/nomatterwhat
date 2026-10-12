// The paid product: Claude reviews the crawled pages and automated check results
// the way a conversion/SEO consultant would, and returns a structured report.

const Anthropic = require('@anthropic-ai/sdk');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { z } = require('zod');
const config = require('./config');

const Finding = z.object({
  title: z.string().describe('Short name of the issue or opportunity'),
  evidence: z.string().describe('What on the site shows this; quote the actual text/element where possible'),
  whyItMatters: z.string().describe('Business impact in plain language: leads, sales, trust, rankings'),
  recommendation: z.string().describe('Specific fix the owner or their web person can act on, including example copy where useful'),
  priority: z.enum(['high', 'medium', 'low']),
  effort: z.enum(['quick win', 'moderate', 'project']),
});

const ReportSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  headline: z.string().describe('One-sentence verdict on the site'),
  executiveSummary: z.string().describe('2-3 short paragraphs for the business owner, separated by blank lines'),
  sections: z.array(z.object({
    area: z.enum(['Messaging & Value Proposition', 'Conversion & Calls to Action', 'Trust & Credibility', 'SEO & Discoverability', 'Mobile & Performance', 'User Experience & Navigation']),
    score: z.number().int().min(0).max(100),
    summary: z.string(),
    findings: z.array(Finding).describe('2-5 findings for this area'),
  })).describe('One entry per area, all six areas'),
  quickWins: z.array(z.string()).describe('5-8 changes doable this week, most impactful first'),
  rewrite: z.object({
    headline: z.string().describe('Suggested replacement hero headline'),
    subheadline: z.string(),
    primaryCta: z.string().describe('Suggested primary button text'),
  }),
  plan: z.array(z.object({
    phase: z.string().describe('e.g. "Days 1-30"'),
    focus: z.string(),
    actions: z.array(z.string()),
  })).describe('Exactly three phases covering 90 days'),
});

const SYSTEM_PROMPT = `You are a senior conversion-rate-optimization and SEO consultant who has audited hundreds of small and mid-sized business websites. A client has paid for a professional audit of their site. You are given the crawled content of their homepage and key subpages, plus results from automated checks.

Write the audit the way a top consultant would:
- Be specific to THIS site. Quote their actual headlines, buttons and copy as evidence. Generic advice that could apply to any site is a failure.
- Lead with what will make them the most money soonest. Prioritize honestly.
- Write for a busy business owner, not a developer: plain language, concrete next steps, example copy where it helps.
- Be candid but constructive. Acknowledge what already works.
- Only claim what the provided data supports. You cannot see visual design, so do not invent claims about colors, layout, or images beyond what the HTML text shows; where something needs a visual check, say so.
- Do not invent statistics or cite studies you cannot name.`;

function summarizePage(page) {
  const fields = {
    url: page.url, title: page.title, metaDescription: page.metaDescription, h1: page.h1, h2: page.h2,
    callsToAction: page.ctas, forms: page.forms, formFields: page.formFields, hasPhone: page.hasPhone,
    hasEmail: page.hasEmail, hasTestimonials: page.hasTestimonials, wordCount: page.wordCount,
  };
  return `${JSON.stringify(fields, null, 2)}\n\nPage text (truncated):\n${page.textExcerpt}`;
}

function buildPrompt({ crawl, checks, previous }) {
  const failing = checks.failing.map((c) => `- FAIL: ${c.label}`).join('\n') || '- All automated checks passed';
  const passing = checks.results.filter((r) => r.pass).map((c) => `- pass: ${c.label}`).join('\n');
  const tech = {
    https: crawl.home.https, serverResponseMs: crawl.home.responseMs, htmlBytes: crawl.home.bytes,
    scripts: crawl.home.scripts, viewport: crawl.home.viewport, canonical: crawl.home.canonical, lang: crawl.home.lang,
    images: crawl.home.imageCount, imagesMissingAlt: crawl.home.imagesMissingAlt, analyticsDetected: crawl.home.analytics,
    structuredData: crawl.home.structuredDataTypes, openGraph: Boolean(crawl.home.ogTitle && crawl.home.ogImage),
  };
  return [
    `Audit this website: ${crawl.home.url}`,
    previous ? `This is a monthly follow-up audit. Last report (${previous.date}) scored ${previous.score}/100. Note what improved or regressed where the data shows it.` : '',
    `## Automated check results (automated score ${checks.score}/100)\n${failing}\n${passing}`,
    `## Technical data\n${JSON.stringify(tech, null, 2)}`,
    `## Homepage\n${summarizePage(crawl.home)}`,
    ...crawl.subpages.map((p) => `## Subpage\n${summarizePage(p)}`),
  ].filter(Boolean).join('\n\n');
}

async function generateReport({ crawl, checks, previous }, client = new Anthropic()) {
  const response = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(ReportSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt({ crawl, checks, previous }) }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error(`Report request was declined: ${JSON.stringify(response.stop_details)}`);
  }
  if (!response.parsed_output) {
    throw new Error(`Report could not be parsed (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

module.exports = { generateReport, buildPrompt, ReportSchema };
