// Try the product without Stripe or email:
//   node src/dry-run.js example.com           # free scan only (no API key needed)
//   node src/dry-run.js example.com --full    # full Claude audit, writes report.html

const fs = require('fs');
const config = require('./config');
const { crawl } = require('./fetch-site');
const { runChecks } = require('./checks');
const { generateReport } = require('./report');
const { renderReport } = require('./email');

async function main() {
  const [site, flag] = process.argv.slice(2);
  if (!site) throw new Error('Usage: node src/dry-run.js <website> [--full]');
  const crawled = await crawl(site);
  const checks = runChecks(crawled.home);
  console.log(`${crawled.home.url}: automated score ${checks.score}/100 (${crawled.subpages.length} subpages crawled)`);
  for (const r of checks.results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label}`);
  if (flag !== '--full') return;
  const report = await generateReport({ crawl: crawled, checks });
  const { html } = renderReport(report, { brandName: config.brandName, siteUrl: crawled.home.url, date: new Date().toISOString().slice(0, 10) });
  fs.writeFileSync('report.html', html);
  console.log(`Full audit scored ${report.overallScore}/100. Wrote report.html`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
