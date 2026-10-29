const test = require('node:test');
const assert = require('node:assert');
const schema = require('../src/schema');
const m = require('../src/matcher');

const NOW = '2026-10-29T12:00:00';
const unit = (o) => schema.finalize({
  id: 'U1', town: 'Somerville', address: '1 Elm St', rent: 2500, bedrooms: 2, bathrooms: 1,
  availableDate: '2026-12-01', leaseTermMonths: 12, petPolicy: ['cats'], amenities: ['laundry', 'near transit'],
  incomeMultiple: 3, minCreditScore: 650, allowsCosigner: true, lastMonthRequired: true, securityDeposit: 2500, ...o,
}, 'unit');
const applicant = (o) => schema.finalize({
  id: 'A1', name: 'Test', maxRent: 2700, minBedrooms: 2, locations: ['Somerville'], moveInDate: '2026-12-01',
  annualIncome: 100000, creditScore: 700, upfrontFunds: 10000, householdSize: 2, ...o,
}, 'applicant');

test('a clean pair is qualified with a high score', () => {
  const r = m.evaluate(applicant(), unit(), {}, NOW);
  assert.strictEqual(r.status, 'qualified');
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.deepStrictEqual(r.dealbreakers, []);
});

test('dealbreakers: budget, bedrooms, dates, pets, must-haves, occupancy', () => {
  const cases = [
    [{}, { rent: 3000 }, /over the/],
    [{ minBedrooms: 3 }, {}, /needs 3/],
    [{ moveInDate: '2026-10-01' }, {}, /days after/],
    [{ pets: ['dog'] }, {}, /No dogs/],
    [{ mustHaves: ['parking'] }, {}, /Parking/],
    [{ householdSize: 5 }, { maxOccupants: 4 }, /occupant limit/],
  ];
  for (const [ao, uo, re] of cases) {
    const r = m.evaluate(applicant(ao), unit(uo), {}, NOW);
    assert.strictEqual(r.status, 'not_a_fit', JSON.stringify(ao) + JSON.stringify(uo));
    assert.ok(r.dealbreakers.some((d) => re.test(d)), r.dealbreakers.join(' | '));
  }
});

test('within rent tolerance is a concern, not a dealbreaker', () => {
  const r = m.evaluate(applicant({ maxRent: 2400 }), unit(), { rentTolerancePct: 5 }, NOW);
  assert.notStrictEqual(r.status, 'not_a_fit');
  assert.ok(r.concerns.some((c) => /over budget/.test(c)));
});

test('location: region-level match and strict mode', () => {
  const nearby = m.evaluate(applicant({ locations: ['Cambridge'] }), unit(), {}, NOW);
  assert.notStrictEqual(nearby.status, 'not_a_fit'); // same Inner Core region
  assert.ok(nearby.fit.location.score < nearby.fit.location.max);
  const far = m.evaluate(applicant({ locations: ['Worcester'] }), unit(), {}, NOW);
  assert.strictEqual(far.status, 'not_a_fit');
  const loose = m.evaluate(applicant({ locations: ['Worcester'] }), unit(), { strictLocation: false }, NOW);
  assert.notStrictEqual(loose.status, 'not_a_fit');
  const region = m.evaluate(applicant({ locations: ['Inner Core'] }), unit(), {}, NOW);
  assert.strictEqual(region.fit.location.score, region.fit.location.max);
  const hood = m.evaluate(applicant({ locations: ['Dorchester'] }), unit({ town: 'Boston', neighborhood: 'South End' }), {}, NOW);
  assert.ok(hood.fit.location.score > 0 && hood.fit.location.score < hood.fit.location.max);
});

test('income test: fail, co-signer conditional, borderline conditional', () => {
  const fail = m.evaluate(applicant({ annualIncome: 60000 }), unit(), {}, NOW);
  assert.strictEqual(fail.status, 'not_qualified');
  const cos = m.evaluate(applicant({ annualIncome: 60000, hasCosigner: true, cosignerAnnualIncome: 150000 }), unit(), {}, NOW);
  assert.strictEqual(cos.status, 'conditional');
  const noCos = m.evaluate(applicant({ annualIncome: 60000, hasCosigner: true, cosignerAnnualIncome: 150000 }), unit({ allowsCosigner: false }), {}, NOW);
  assert.strictEqual(noCos.status, 'not_qualified');
  const close = m.evaluate(applicant({ annualIncome: 85000 }), unit(), {}, NOW); // 7083 vs 7500
  assert.strictEqual(close.checks.find((c) => c.check === 'Income').result, 'conditional');
});

test('voucher holders: income tested on tenant share; refusal is flagged not enforced', () => {
  const a = applicant({ annualIncome: 30000, hasVoucher: true, voucherAmount: 1800, upfrontFunds: 4000 });
  const r = m.evaluate(a, unit({ acceptsVouchers: false }), {}, NOW);
  assert.strictEqual(r.tenantPortion, 700);
  assert.strictEqual(r.checks.find((c) => c.check === 'Income').result, 'pass'); // 2500/mo ≥ 3×700
  assert.notStrictEqual(r.status, 'not_a_fit');
  assert.ok(r.compliance.some((f) => f.code === 'voucher_refusal'));
  const noVoucher = m.evaluate(applicant(), unit({ acceptsVouchers: false }), {}, NOW);
  assert.ok(!noVoucher.compliance.some((f) => f.code === 'voucher_refusal'));
});

test('move-in cost includes last month, deposit and tenant-paid broker fee', () => {
  const c = m.moveInCost(applicant(), unit({ brokerFee: 2500, brokerFeeTenantPays: true }));
  assert.strictEqual(c.total, 2500 * 4);
  const r = m.evaluate(applicant({ upfrontFunds: 5000 }), unit(), {}, NOW);
  assert.strictEqual(r.checks.find((c) => c.check === 'Move-in funds').result, 'fail');
});

test('MA compliance flags on landlord terms', () => {
  const codes = m.unitCompliance(unit({ applicationFee: 50, securityDeposit: 3000, yearBuilt: 1950 })).map((f) => f.code);
  assert.ok(codes.includes('application_fee'));
  assert.ok(codes.includes('deposit_cap'));
  assert.ok(codes.includes('lead_unknown'));
  const lead = m.evaluate(applicant({ childUnder6: true }), unit({ yearBuilt: 1920, leadCompliant: false }), {}, NOW);
  assert.ok(lead.compliance.some((f) => f.code === 'lead_law'));
  assert.notStrictEqual(lead.status, 'not_a_fit'); // never excluded for having a child
});

test('assistance animals are not treated as pets', () => {
  const r = m.evaluate(applicant({ assistanceAnimal: true }), unit({ petPolicy: ['none'] }), {}, NOW);
  assert.deepStrictEqual(r.dealbreakers, []);
  assert.ok(r.compliance.some((f) => f.code === 'assistance_animal'));
});

test('missing applicant data yields conditional, not failure', () => {
  const r = m.evaluate(applicant({ annualIncome: null, creditScore: null, upfrontFunds: null }), unit(), {}, NOW);
  assert.strictEqual(r.status, 'conditional');
});

test('ranking: qualified first, inactive records excluded', () => {
  const units = [unit({ id: 'cheap', rent: 2000 }), unit({ id: 'far', town: 'Worcester' }), unit({ id: 'gone', status: 'leased' })];
  const res = m.matchApplicant(applicant(), units, {}, NOW);
  assert.deepStrictEqual(res.map((r) => r.unitId), ['cheap', 'far']);
  const apps = [applicant({ id: 'poor', annualIncome: 20000 }), applicant({ id: 'good' }), applicant({ id: 'done', status: 'placed' })];
  assert.deepStrictEqual(m.matchUnit(unit(), apps, {}, NOW).map((r) => r.applicantId), ['good', 'poor']);
});

test('sample data imports cleanly and produces matches', () => {
  const csv = require('../src/csv');
  const samples = require('../src/sample-data');
  const load = (text, kind) => {
    const { headers, records } = csv.parse(text);
    const map = schema.autoMapHeaders(headers, kind);
    assert.ok(Object.values(map).every(Boolean), `${kind} unmapped: ${Object.keys(map).filter((k) => !map[k])}`);
    return records.map((r) => schema.normalizeRecord(r, kind, map));
  };
  const units = load(samples.units, 'unit');
  const apps = load(samples.applicants, 'applicant');
  assert.strictEqual(units.length, 14);
  assert.strictEqual(apps.length, 8);
  const all = m.matchAll(apps, units, {}, NOW);
  assert.ok(all.filter((r) => r.status === 'qualified').length >= 4);
});
