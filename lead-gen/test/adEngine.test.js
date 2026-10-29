const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const load = require('./load');

const E = load('AdEngine.gs');
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const OPTS = { agentName: 'James Guilford', brokerage: 'DiBiasio Realty', phone: '(508) 555-0123',
               landingUrl: 'https://example.com/unit?id=7#photos', noBrokerFee: true };

// vm objects come from another realm; round-trip through JSON for deepEqual.
const plain = (x) => JSON.parse(JSON.stringify(x));


test('parses a Zillow paste', () => {
  const L = E.parseListing(fixture('zillow.txt'));
  assert.equal(L.source, 'zillow');
  assert.equal(L.address, '12 Maple St');
  assert.equal(L.unit, '2');
  assert.equal(L.city, 'Framingham');
  assert.equal(L.zip, '01702');
  assert.equal(L.rent, '2150');
  assert.equal(L.beds, '2');
  assert.equal(L.baths, '1');
  assert.equal(L.sqft, '950');
  assert.equal(L.available, 'Nov 1');
  assert.equal(L.leaseTerm, '12 months');
  assert.equal(L.deposit, '2150');
  assert.equal(L.pets, 'Cats & small dogs OK');
  assert.equal(L.laundry, 'In-unit washer/dryer');
  assert.equal(L.parking, '1 off-street parking space');
  assert.deepEqual(plain(L.utilities), ['Heat', 'Hot water']);
  assert.ok(L.amenities.includes('Dishwasher'));
  assert.ok(L.amenities.includes('Near commuter rail'));
  assert.match(L.description, /^Bright second-floor apartment/);
  assert.doesNotMatch(L.description, /Heat included\s+Hardwood/, 'chip rows are not prose');
  assert.deepEqual(plain(L.missing), []);
});


test('parses a Facebook Marketplace paste', () => {
  const L = E.parseListing(fixture('marketplace.txt'));
  assert.equal(L.source, 'marketplace');
  assert.equal(L.propertyType, 'Townhouse');
  assert.equal(L.city, 'Worcester');
  assert.equal(L.rent, '2400');
  assert.equal(L.beds, '3');
  assert.equal(L.baths, '1.5');
  assert.equal(L.sqft, '1200');
  assert.equal(L.available, 'Dec 1');
  assert.equal(L.pets, 'Cats & dogs OK');
  assert.ok(L.amenities.includes('Central air'));
  assert.ok(L.amenities.includes('Fenced yard'));
  assert.ok(!L.amenities.includes('Yard'), 'fenced yard supersedes yard');
});


test('handles a studio and a plain-text listing', () => {
  const L = E.parseListing('Sunny studio apartment for rent in Natick, MA 01760. $1,450 per month. ' +
                           'Heat and hot water included. Laundry in the building. Available now.');
  assert.equal(L.beds, '0');
  assert.equal(L.city, 'Natick');
  assert.equal(L.rent, '1450');
  assert.equal(L.available, 'now');
  assert.equal(L.laundry, 'Laundry on site');
  const ads = E.generateAds(L, {}).ads;
  const cl = ads.find((a) => a.key === 'craigslist');
  assert.match(cl.fields[0].value, /^Studio apartment/);
});


test('flags illegal and risky ad language', () => {
  const hits = (t) => E.lintText(t).map((h) => h.id + ':' + h.severity);
  assert.deepEqual(plain(hits('No Section 8.')), ['source-of-income:block']);
  assert.deepEqual(plain(hits('Vouchers not accepted.')), ['source-of-income-2:block']);
  assert.deepEqual(plain(hits('No kids please.')), ['familial-status:block']);
  assert.deepEqual(plain(hits('Perfect for a quiet couple.')), ['familial-status:block']);
  assert.deepEqual(plain(hits('Mature tenants preferred.')), ['age:block']);
  assert.deepEqual(plain(hits('No emotional support animals.')), ['disability:block']);
  assert.deepEqual(plain(hits('Must make 3x the rent.')), ['income-multiple:warn']);
  assert.deepEqual(plain(hits('$50 application fee.')), ['ma-upfront-fees:warn']);
  assert.deepEqual(plain(hits('Tenant pays broker fee.')), ['ma-broker-fee:info']);

  // Describing the unit is fine.
  assert.deepEqual(plain(hits('No pets. No smoking. Third-floor walk-up, not wheelchair accessible.')), []);
  assert.deepEqual(plain(hits('Close to St. Mary\'s church and the commuter rail.')), []);
});


test('flags a security deposit above one month', () => {
  const lint = E.lintListing({ rent: '2000', deposit: '3000', description: '' });
  assert.ok(lint.some((h) => h.id === 'ma-deposit-cap'));
});


test('generated ads drop blocked sentences and pass their own lint', () => {
  const L = E.parseListing(fixture('zillow.txt'));
  const r = E.generateAds(L, OPTS);
  assert.deepEqual(plain(r.removed), ['No Section 8.']);
  assert.equal(r.ads.length, E.adPlatforms().length);
  for (const ad of r.ads) {
    const all = ad.fields.map((f) => f.value).join('\n');
    assert.doesNotMatch(all, /No Section 8/, ad.label);
    assert.doesNotMatch(all, /508-555-0199/, ad.label + ' must not carry the old contact number');
    assert.deepEqual(plain(ad.lint), [], ad.label + ' lint');
  }
});


test('every limited field fits its platform limit', () => {
  for (const file of ['zillow.txt', 'marketplace.txt']) {
    const r = E.generateAds(E.parseListing(fixture(file)), OPTS);
    for (const ad of r.ads) {
      for (const f of ad.fields) {
        if (f.limit) assert.ok(f.value.length <= f.limit, `${file} ${ad.label} "${f.name}" is ${f.value.length}/${f.limit}: ${f.value}`);
      }
    }
  }
});


test('Google Ads gets 15 distinct headlines and 4 descriptions', () => {
  const r = E.generateAds(E.parseListing(fixture('zillow.txt')), OPTS);
  const ga = r.ads.find((a) => a.key === 'googleAds');
  const heads = ga.fields.filter((f) => /^Headline \d+$/.test(f.name)).map((f) => f.value.toLowerCase());
  const descs = ga.fields.filter((f) => /^Description \d+$/.test(f.name));
  assert.equal(heads.length, 15);
  assert.equal(new Set(heads).size, 15);
  assert.equal(descs.length, 4);
  for (const h of heads) assert.doesNotMatch(h, /\(\d{3}\)|\d{3}-\d{4}/, 'no phone numbers in Google ad text');
});


test('each ad carries a unique, parseable tracking ref', () => {
  const L = E.parseListing(fixture('zillow.txt'));
  const r = E.generateAds(L, OPTS);
  const refs = r.ads.map((a) => a.ref);
  assert.equal(new Set(refs).size, refs.length);
  for (const ad of r.ads) {
    const body = ad.fields.map((f) => f.value).join('\n');
    if (ad.key !== 'metaAds' && ad.key !== 'googleAds') assert.ok(body.includes(ad.ref), ad.label + ' shows its ref');
    const back = E.parseAdRef('Hi, I saw your ad (' + ad.ref.toLowerCase() + ') — is it available?');
    assert.equal(back.ref, ad.ref);
    assert.equal(back.platform, ad.label);
  }
  // Same unit -> same refs on every run.
  assert.deepEqual(plain(E.generateAds(L, OPTS).ads.map((a) => a.ref)), plain(refs));
  assert.equal(E.parseAdRef('nothing here'), null);
});


test('tracked URLs keep existing params and fragments', () => {
  const p = E.adPlatforms().find((x) => x.key === 'craigslist');
  const url = E.buildTrackedUrl('https://example.com/unit?id=7#photos', p, 'AB2C', 'DBR-AB2C-CL');
  assert.equal(url, 'https://example.com/unit?id=7&utm_source=craigslist&utm_medium=classified' +
                    '&utm_campaign=rental-ab2c&utm_content=DBR-AB2C-CL#photos');
});


test('the source platform is marked', () => {
  const z = E.generateAds(E.parseListing(fixture('zillow.txt')), OPTS).ads;
  assert.deepEqual(plain(z.filter((a) => a.isSource).map((a) => a.key)), ['zillow']);
  const m = E.generateAds(E.parseListing(fixture('marketplace.txt')), OPTS).ads;
  assert.deepEqual(plain(m.filter((a) => a.isSource).map((a) => a.key)), ['marketplace']);
});


test('options change the copy', () => {
  const L = E.parseListing(fixture('zillow.txt'));
  const off = E.generateAds(L, { showAddress: false, welcomeVouchers: false, noBrokerFee: false }).ads;
  const cl = off.find((a) => a.key === 'craigslist').fields.find((f) => f.name === 'Posting body').value;
  assert.doesNotMatch(cl, /Maple St/);
  assert.doesNotMatch(cl, /No broker fee/);
  assert.match(cl, /Equal Housing Opportunity\.$/);
  const ig = off.find((a) => a.key === 'social').fields.find((f) => f.name === 'Hashtags').value;
  assert.doesNotMatch(ig, /#VouchersWelcome/);
});


test('matches past prospects on city, bedrooms and budget only', () => {
  const L = { city: 'Framingham', beds: '2', rent: '2150' };
  const now = Date.parse('2026-10-29T12:00:00Z');
  const day = 86400000;
  const leads = [
    { name: 'Exact Fit', email: 'a@x.com', city: 'Framingham', bedrooms: '2', budget: '2,300', firstSeen: now - 3 * day },
    { name: 'Nearby',    email: 'b@x.com', city: 'Natick',     bedrooms: '2', budget: '',      firstSeen: now - 5 * day },
    { name: 'Too Big',   email: 'c@x.com', city: 'Framingham', bedrooms: '3', budget: '3000',  firstSeen: now - 1 * day },
    { name: 'Too Low',   email: 'd@x.com', city: 'Framingham', bedrooms: '2', budget: '1500',  firstSeen: now - 1 * day },
    { name: 'Stale',     email: 'e@x.com', city: 'Framingham', bedrooms: '2', budget: '2200',  firstSeen: now - 200 * day },
    { name: 'No Contact',               city: 'Framingham', bedrooms: '2', budget: '2200',  firstSeen: now - 1 * day },
    { name: 'Dup',       email: 'A@x.com', city: 'Framingham', bedrooms: '2', budget: '2300', firstSeen: now - 9 * day },
    { name: 'Smaller',   phone: '(508) 555-1111', city: 'Framingham', bedrooms: '1', budget: '2100', firstSeen: now - 2 * day }
  ];
  const out = E.matchProspects(L, leads, { now: now, maxAgeDays: 90 });
  assert.deepEqual(plain(out.map((p) => p.name)), ['Exact Fit', 'Smaller', 'Nearby']);
  assert.equal(out[0].matchScore, 7);
  assert.deepEqual(plain(out[0].matchReasons), ['wants Framingham', 'wants 2 BR', 'budget $2,300']);
});
