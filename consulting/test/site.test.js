const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl, isPrivateAddress, safeFetch, extract, pickSubpages, crawl } = require('../src/fetch-site');
const { runChecks } = require('../src/checks');
const { GOOD_HTML, POOR_HTML } = require('./fixtures');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const htmlResponse = (html, status = 200, headers = {}) => new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

test('isPrivateAddress catches internal ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
});

test('normalizeUrl adds https and rejects unsafe inputs', () => {
  assert.equal(normalizeUrl('acme.test').toString(), 'https://acme.test/');
  assert.equal(normalizeUrl('http://acme.test/x#frag').toString(), 'http://acme.test/x');
  for (const bad of ['', 'ftp://acme.test', 'http://localhost', 'http://127.0.0.1', 'http://u:p@acme.test', 'http://acme.test:8080', 'file:///etc/passwd']) {
    assert.throws(() => normalizeUrl(bad), undefined, bad);
  }
});

test('safeFetch refuses hosts resolving to private IPs, including via redirect', async () => {
  const lookup = async (host) => [{ address: host === 'internal.acme.test' ? '10.0.0.5' : '93.184.216.34', family: 4 }];
  await assert.rejects(safeFetch('internal.acme.test', { lookup, fetchImpl: async () => htmlResponse('x') }), /public internet/);

  const fetchImpl = async (url) => (url.hostname === 'acme.test'
    ? new Response(null, { status: 302, headers: { location: 'https://internal.acme.test/' } })
    : htmlResponse('secret'));
  await assert.rejects(safeFetch('acme.test', { lookup, fetchImpl }), /public internet/);
});

test('safeFetch follows public redirects and rejects non-HTML', async () => {
  const fetchImpl = async (url) => (url.pathname === '/'
    ? new Response(null, { status: 301, headers: { location: '/home' } })
    : htmlResponse(GOOD_HTML));
  const page = await safeFetch('acme.test', { lookup: publicLookup, fetchImpl });
  assert.equal(page.url, 'https://acme.test/home');
  assert.match(page.html, /Acme Plumbing/);

  await assert.rejects(
    safeFetch('acme.test', { lookup: publicLookup, fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) }),
    /did not return a web page/,
  );
  await assert.rejects(safeFetch('acme.test', { lookup: publicLookup, fetchImpl: async () => htmlResponse('x', 500) }), /HTTP 500/);
});

test('extract pulls the facts an auditor needs', () => {
  const p = extract({ url: 'https://acme.test/', html: GOOD_HTML, bytes: GOOD_HTML.length, responseMs: 300 });
  assert.equal(p.title, 'Acme Plumbing | 24/7 Plumbers in Austin, TX');
  assert.deepEqual(p.h1, ['Fast, honest plumbing in Austin']);
  assert.ok(p.ctas.includes('Book a plumber'));
  assert.ok(p.ctas.includes('Request a quote'));
  assert.equal(p.forms, 1);
  assert.equal(p.formFields, 2);
  assert.ok(p.hasPhone && p.hasTestimonials && p.analytics && p.hasPrivacyLink);
  assert.deepEqual(p.structuredDataTypes, ['Plumber']);
  assert.ok(!p.internalLinks.some((l) => l.includes('elsewhere.test')));
  assert.deepEqual(pickSubpages(p), ['https://acme.test/book', 'https://acme.test/services', 'https://acme.test/about']);
});

test('runChecks scores a strong site high and a weak site low with prioritized issues', () => {
  const good = runChecks(extract({ url: 'https://acme.test/', html: GOOD_HTML, bytes: GOOD_HTML.length, responseMs: 300 }));
  assert.equal(good.score, 100);
  const poor = runChecks(extract({ url: 'http://acme.test/', html: POOR_HTML, bytes: POOR_HTML.length, responseMs: 2500 }));
  assert.ok(poor.score < 30, `score ${poor.score}`);
  assert.equal(poor.failing[0].id, 'cta'); // heaviest weight first
  assert.ok(poor.failing.some((f) => f.id === 'https'));
  assert.ok(poor.failing.some((f) => f.id === 'h1'));
});

test('crawl fetches homepage plus key subpages and tolerates broken ones', async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url.pathname);
    return url.pathname === '/about' ? htmlResponse('gone', 404) : htmlResponse(GOOD_HTML);
  };
  const result = await crawl('acme.test', { lookup: publicLookup, fetchImpl });
  assert.deepEqual(fetched, ['/', '/book', '/services', '/about']);
  assert.equal(result.subpages.length, 2);
});
