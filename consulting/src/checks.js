// Deterministic checks: free to run, so they power the free scan (lead magnet)
// and give Claude hard evidence to build the paid report on.

const CHECKS = [
  { id: 'https', weight: 10, label: 'Secure connection (HTTPS)', test: (p) => p.https,
    fix: 'Serve the site over HTTPS. Browsers flag non-HTTPS pages as "Not secure", which kills trust and conversions.' },
  { id: 'speed', weight: 10, label: 'Fast server response', test: (p) => p.responseMs < 1500,
    fix: 'Your homepage took over 1.5s to respond. Add caching or a CDN; every extra second loses visitors.' },
  { id: 'viewport', weight: 10, label: 'Mobile-friendly setup', test: (p) => /width=device-width/.test(p.viewport),
    fix: 'Add a responsive viewport meta tag. Without it, phones render a shrunken desktop page.' },
  { id: 'title', weight: 8, label: 'Search-friendly page title', test: (p) => p.title.length >= 15 && p.title.length <= 65,
    fix: 'Write a 15–65 character page title naming what you do and where. It is the headline people see in Google.' },
  { id: 'description', weight: 6, label: 'Meta description', test: (p) => p.metaDescription.length >= 50 && p.metaDescription.length <= 165,
    fix: 'Add a 50–165 character meta description that sells the click from search results.' },
  { id: 'h1', weight: 8, label: 'One clear headline', test: (p) => p.h1.length === 1,
    fix: 'Use exactly one H1 headline that states the outcome you deliver for customers.' },
  { id: 'cta', weight: 12, label: 'Clear call to action', test: (p) => p.ctas.length >= 1,
    fix: 'Add a prominent call-to-action button ("Book a call", "Get a quote") above the fold.' },
  { id: 'contact', weight: 8, label: 'Easy to contact', test: (p) => p.hasPhone || p.hasEmail || p.forms > 0,
    fix: 'Show a phone number, email, or contact form on the homepage. Visitors who can\'t reach you leave.' },
  { id: 'social-proof', weight: 8, label: 'Social proof (reviews/testimonials)', test: (p) => p.hasTestimonials,
    fix: 'Add testimonials, star ratings, or client logos. Social proof is one of the strongest conversion levers.' },
  { id: 'alt', weight: 4, label: 'Image alt text', test: (p) => p.imageCount === 0 || p.imagesMissingAlt / p.imageCount <= 0.2,
    fix: 'Add descriptive alt text to images. It helps SEO and accessibility (and limits ADA lawsuit exposure).' },
  { id: 'analytics', weight: 6, label: 'Analytics installed', test: (p) => p.analytics,
    fix: 'Install analytics (e.g. Google Analytics 4). You can\'t improve what you don\'t measure.' },
  { id: 'schema', weight: 4, label: 'Structured data for Google', test: (p) => p.structuredDataTypes.length > 0,
    fix: 'Add schema.org structured data (LocalBusiness / Organization) to qualify for rich search results.' },
  { id: 'social-card', weight: 3, label: 'Social sharing preview', test: (p) => Boolean(p.ogTitle && p.ogImage),
    fix: 'Add Open Graph tags so links to your site show a title and image when shared.' },
  { id: 'weight', weight: 3, label: 'Lean page size', test: (p) => p.bytes < 500 * 1024 && p.scripts < 40,
    fix: 'The page HTML is heavy or loads many scripts. Trim unused plugins and trackers to speed it up.' },
];

function runChecks(page) {
  const results = CHECKS.map(({ test, ...check }) => ({ ...check, pass: Boolean(test(page)) }));
  const total = CHECKS.reduce((sum, c) => sum + c.weight, 0);
  const earned = results.filter((r) => r.pass).reduce((sum, r) => sum + r.weight, 0);
  const failing = results.filter((r) => !r.pass).sort((a, b) => b.weight - a.weight);
  return { score: Math.round((earned / total) * 100), results, failing };
}

module.exports = { runChecks, CHECKS };
