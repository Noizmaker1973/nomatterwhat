// Fetches a customer's website safely and extracts the facts an auditor looks
// at. URLs come from the public, so every request (including each redirect hop)
// is checked to point at a public internet address, never our own network.

const dns = require('dns').promises;
const net = require('net');
const cheerio = require('cheerio');

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 4;
const USER_AGENT = 'Mozilla/5.0 (compatible; SiteAuditBot/1.0; +website audit)';

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const PRIVATE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
].map(([base, bits]) => [ipv4ToInt(base), bits]);

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
}

function normalizeUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('Please enter a website address.');
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That does not look like a website address.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https sites can be audited.');
  if (url.username || url.password) throw new Error('Website addresses with credentials are not supported.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Only standard web ports can be audited.');
  if (!url.hostname.includes('.') || net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new Error('Please enter a public domain name, like example.com.');
  }
  url.hash = '';
  return url;
}

async function assertPublicHost(hostname, lookup = dns.lookup) {
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('That site is not reachable on the public internet.');
  }
}

async function readLimited(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function safeFetch(input, { fetchImpl = fetch, lookup = dns.lookup } = {}) {
  let url = normalizeUrl(input);
  const started = Date.now();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname, lookup);
    const res = await fetchImpl(url, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = normalizeUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) throw new Error(`The site returned HTTP ${res.status}.`);
    if (!/html/i.test(contentType)) throw new Error('That address did not return a web page.');
    const html = await readLimited(res, MAX_BYTES);
    return { url: url.toString(), html, bytes: Buffer.byteLength(html), responseMs: Date.now() - started };
  }
  throw new Error('The site redirected too many times.');
}

const CTA_WORDS = /\b(get|start|book|schedule|buy|shop|order|contact|call|request|quote|demo|try|sign up|subscribe|join|download|free|apply|reserve)\b/i;

function extract(page) {
  const $ = cheerio.load(page.html);
  const url = new URL(page.url);
  const text = (sel) => $(sel).map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);

  const internalLinks = new Set();
  $('a[href]').each((_, el) => {
    try {
      const link = new URL($(el).attr('href'), url);
      if (link.hostname === url.hostname && /^https?:$/.test(link.protocol)) {
        link.hash = '';
        internalLinks.add(link.toString());
      }
    } catch { /* ignore malformed hrefs */ }
  });

  const ctas = [...new Set([
    ...text('button'),
    ...$('a').filter((_, el) => /btn|button|cta/i.test($(el).attr('class') || '') || CTA_WORDS.test($(el).text()))
      .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get(),
    ...$('input[type=submit]').map((_, el) => $(el).attr('value') || '').get(),
  ].filter((t) => t && t.length <= 60))].slice(0, 25);

  const images = $('img');
  const structuredDataTypes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      for (const item of [].concat(data['@graph'] || data)) if (item && item['@type']) structuredDataTypes.push([].concat(item['@type']).join(','));
    } catch { /* invalid JSON-LD is itself a finding, but not one we score */ }
  });

  $('script, style, noscript, svg').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

  return {
    url: page.url,
    https: url.protocol === 'https:',
    responseMs: page.responseMs,
    bytes: page.bytes,
    title: $('title').first().text().trim(),
    metaDescription: $('meta[name="description"]').attr('content')?.trim() || '',
    viewport: $('meta[name="viewport"]').attr('content') || '',
    canonical: $('link[rel="canonical"]').attr('href') || '',
    lang: $('html').attr('lang') || '',
    ogTitle: $('meta[property="og:title"]').attr('content') || '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    favicon: $('link[rel~="icon"]').length > 0,
    h1: text('h1').slice(0, 5),
    h2: text('h2').slice(0, 15),
    ctas,
    forms: $('form').length,
    formFields: $('form input:not([type=hidden]), form textarea, form select').length,
    imageCount: images.length,
    imagesMissingAlt: images.filter((_, el) => !($(el).attr('alt') || '').trim()).length,
    scripts: (page.html.match(/<script\b/gi) || []).length,
    hasPhone: /(\+?\d[\d\s().-]{8,}\d)/.test(bodyText) || $('a[href^="tel:"]').length > 0,
    hasEmail: $('a[href^="mailto:"]').length > 0 || /[\w.+-]+@[\w-]+\.[\w.]+/.test(bodyText),
    hasTestimonials: /testimonial|review|what (our )?(clients|customers) say|★|5[- ]star/i.test(bodyText),
    hasPrivacyLink: $('a').filter((_, el) => /privacy/i.test($(el).text())).length > 0,
    analytics: /googletagmanager|google-analytics|gtag\(|plausible|segment\.com|hotjar|clarity\.ms|fbq\(/i.test(page.html),
    structuredDataTypes,
    wordCount: bodyText ? bodyText.split(' ').length : 0,
    textExcerpt: bodyText.slice(0, 6000),
    internalLinks: [...internalLinks],
  };
}

// The pages a consultant would open after the homepage.
function pickSubpages(home, max = 3) {
  const priority = /(pricing|price|services?|solutions?|products?|about|contact|book|quote|plans?)/i;
  return home.internalLinks
    .filter((link) => {
      const path = new URL(link).pathname;
      return path !== '/' && priority.test(path) && !/\.(pdf|jpe?g|png|zip)$/i.test(path);
    })
    .slice(0, max);
}

async function crawl(input, opts = {}) {
  const home = extract(await safeFetch(input, opts));
  const subpages = [];
  for (const link of pickSubpages(home)) {
    try {
      subpages.push(extract(await safeFetch(link, opts)));
    } catch { /* a broken subpage shouldn't sink the audit */ }
  }
  return { home, subpages };
}

module.exports = { normalizeUrl, isPrivateAddress, assertPublicHost, safeFetch, extract, pickSubpages, crawl };
