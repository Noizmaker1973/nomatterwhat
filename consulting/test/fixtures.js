const GOOD_HTML = `<!doctype html><html lang="en"><head>
<title>Acme Plumbing | 24/7 Plumbers in Austin, TX</title>
<meta name="description" content="Licensed Austin plumbers available 24/7. Upfront pricing, same-day service, and a 1-year guarantee on all repairs.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="Acme Plumbing"><meta property="og:image" content="/og.png">
<link rel="canonical" href="https://acme.test/"><link rel="icon" href="/favicon.ico">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Acme"}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
</head><body>
<h1>Fast, honest plumbing in Austin</h1>
<h2>Services</h2><h2>Reviews</h2>
<a class="btn btn-primary" href="/book">Book a plumber</a>
<a href="/services">Our services</a> <a href="/about">About us</a> <a href="/pricing">Pricing</a>
<a href="https://elsewhere.test/x">Partner</a> <a href="/blog/post-1">Blog</a>
<p>Call <a href="tel:+15125550100">(512) 555-0100</a></p>
<section><h3>What our customers say</h3><p>★★★★★ "Fixed our leak in an hour."</p></section>
<img src="/a.jpg" alt="Technician at work"><img src="/b.jpg" alt="Van">
<form><input name="name"><input type="email" name="email"><input type="hidden" name="t"><button>Request a quote</button></form>
<a href="/privacy">Privacy policy</a>
</body></html>`;

const POOR_HTML = `<html><head><title>Home</title></head><body>
<h1>Welcome</h1><h1>To our website</h1>
<p>We have been in business since 1998 and we do many things.</p>
<img src="/a.jpg"><img src="/b.jpg">
</body></html>`;

const REPORT = {
  overallScore: 64,
  headline: 'Solid basics, but the offer <is> buried.',
  executiveSummary: 'First paragraph.\n\nSecond paragraph.',
  sections: ['Messaging & Value Proposition', 'Conversion & Calls to Action', 'Trust & Credibility', 'SEO & Discoverability', 'Mobile & Performance', 'User Experience & Navigation']
    .map((area, i) => ({
      area, score: 50 + i, summary: `Summary ${i}`,
      findings: [{ title: `Finding ${i}`, evidence: 'Headline says "Welcome"', whyItMatters: 'Visitors bounce', recommendation: 'Say what you do', priority: 'high', effort: 'quick win' }],
    })),
  quickWins: ['Add a phone number', 'Rewrite the H1'],
  rewrite: { headline: 'Same-day plumbing in Austin', subheadline: 'Upfront prices.', primaryCta: 'Book now' },
  plan: [1, 2, 3].map((n) => ({ phase: `Days ${n}`, focus: `Focus ${n}`, actions: [`Action ${n}`] })),
};

module.exports = { GOOD_HTML, POOR_HTML, REPORT };
