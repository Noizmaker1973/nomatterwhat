const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load');

// The digest and the engine share one Apps Script global namespace. Loading
// them together catches name collisions (a duplicate `const` throws here).
const G = load('RentalLeadDigest.gs', 'AdEngine.gs', 'AdConverter.gs');


test('engine and digest load together without name collisions', () => {
  assert.equal(typeof G.runDailyReport, 'function');
  assert.equal(typeof G.generateAds, 'function');
});


test('tags a lead with the ad it came from', () => {
  const lead = { subject: 'Re: 2BR in Framingham', body: 'Saw your post (Ref: DBR-MCAQ-CL). Is it still available?' };
  G.tagAdRef_(lead);
  assert.equal(lead.adRef, 'DBR-MCAQ-CL');
  assert.equal(lead.adPlatform, 'Craigslist');

  const plain = { subject: 'Apartment question', body: 'Looking for a 2 bed in Natick.' };
  G.tagAdRef_(plain);
  assert.equal(plain.adRef, '');
});


test('scoring is unchanged by attribution', () => {
  const lead = { subject: 'Re: 2BR', body: 'Ref: DBR-MCAQ-CL. Need a place asap, I have a Section 8 voucher.',
                 phone: '(508) 555-0100', email: 'r@x.com', name: 'R', city: 'Framingham',
                 bedrooms: '2', budget: '2100', moveIn: 'Nov 1', inbound: true, link: 'x' };
  const before = G.scoreLead_(lead);
  G.tagAdRef_(lead);
  assert.equal(G.scoreLead_(lead), before);
});
