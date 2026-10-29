const test = require('node:test');
const assert = require('node:assert');
const schema = require('../src/schema');
const geo = require('../src/ma-geo');

test('money, beds, bool and multiple parsers', () => {
  assert.strictEqual(schema.parseMoney('$2,450/mo'), 2450);
  assert.strictEqual(schema.parseMoney('85k'), 85000);
  assert.strictEqual(schema.parseMoney(''), null);
  assert.strictEqual(schema.parseBeds('Studio'), 0);
  assert.strictEqual(schema.parseBeds('2 BR'), 2);
  assert.strictEqual(schema.parseBool('Yes'), true);
  assert.strictEqual(schema.parseBool('not allowed'), false);
  assert.strictEqual(schema.parseBool('maybe'), null);
  assert.strictEqual(schema.parseMultiple('3x'), 3);
  assert.strictEqual(schema.parseMultiple('40x'), 3.33); // annual 40× rule → monthly
});

test('date parser handles common formats', () => {
  const now = new Date('2026-10-29T12:00:00');
  assert.strictEqual(schema.parseDate('2026-12-01', now), '2026-12-01');
  assert.strictEqual(schema.parseDate('12/1/2026', now), '2026-12-01');
  assert.strictEqual(schema.parseDate('9/1/27', now), '2027-09-01');
  assert.strictEqual(schema.parseDate('Sept 1', now), '2027-09-01'); // past date → next year
  assert.strictEqual(schema.parseDate('Dec 15', now), '2026-12-15');
  assert.strictEqual(schema.parseDate('Now', now), '2026-10-29');
});

test('auto-maps messy spreadsheet headers', () => {
  const m = schema.autoMapHeaders(['MLS #', 'City', 'Monthly Rent', 'Beds', 'Section 8', 'Random'], 'unit');
  assert.deepStrictEqual(m, { 'MLS #': 'id', City: 'town', 'Monthly Rent': 'rent', Beds: 'bedrooms', 'Section 8': 'acceptsVouchers', Random: null });
  const a = schema.autoMapHeaders(['Client Name', 'Budget', 'Beds', 'Monthly Income', 'FICO'], 'applicant');
  assert.deepStrictEqual(a, { 'Client Name': 'name', Budget: 'maxRent', Beds: 'minBedrooms', 'Monthly Income': 'monthlyIncome', FICO: 'creditScore' });
});

test('template headers re-import to the same fields', () => {
  for (const kind of ['unit', 'applicant']) {
    const headers = schema.templateCSVHeader(kind);
    const m = schema.autoMapHeaders(headers, kind);
    assert.ok(Object.values(m).every(Boolean), `${kind}: ${JSON.stringify(m)}`);
  }
});

test('normalizes a unit: neighborhood in town column, region, extras', () => {
  const raw = { City: 'Dorchester', Rent: '$2,600', Beds: '2', Parking: 'yes' };
  const u = schema.normalizeRecord(raw, 'unit', schema.autoMapHeaders(Object.keys(raw), 'unit'));
  assert.strictEqual(u.town, 'Boston');
  assert.strictEqual(u.neighborhood, 'Dorchester');
  assert.strictEqual(u.region, 'Boston');
  assert.strictEqual(u.status, 'available');
  assert.deepStrictEqual(u.extra, { Parking: 'yes' });
});

test('monthly income converts to annual', () => {
  const raw = { Name: 'X', 'Monthly Income': '5,000' };
  const a = schema.normalizeRecord(raw, 'applicant', schema.autoMapHeaders(Object.keys(raw), 'applicant'));
  assert.strictEqual(a.annualIncome, 60000);
  assert.ok(!('monthlyIncome' in a));
});

test('amenity aliases canonicalize and imply', () => {
  assert.strictEqual(schema.canonicalAmenity('W/D'), 'in_unit_laundry');
  assert.strictEqual(schema.canonicalAmenity('Near T'), 'near_transit');
  const set = schema.expandAmenities(['washer dryer', 'utilities included']);
  assert.ok(set.has('laundry') && set.has('heat_included'));
});

test('geo resolves towns, villages and regions', () => {
  assert.deepStrictEqual(geo.resolvePlace('jamaica plain'), { town: 'Boston', neighborhood: 'Jamaica Plain', region: 'Boston' });
  assert.strictEqual(geo.regionOf('Somerville'), 'Inner Core');
  assert.strictEqual(geo.regionOf('Hyannis'), 'Cape & Islands');
  assert.strictEqual(geo.asRegion('cape cod'), 'Cape & Islands');
  assert.strictEqual(geo.asRegion('Somerville'), null);
});
