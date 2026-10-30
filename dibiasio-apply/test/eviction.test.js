// Eviction / court-records check: who gets searched and how results are summarised.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { inPackage } = require('../lib/package');

const ctx = { DRUI: { esc: (s) => String(s), date: (s) => s } };
vm.createContext(ctx);
for (const f of ['ygl.js', 'eviction.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8'), ctx);
const { subjects, summary } = ctx.DREviction;

test('Beantown: each adult with date of birth, addresses and their own answer', () => {
  const list = subjects('beantown', {
    curStreet: '12 Lexington St', curCity: 'Waltham', curState: 'MA', curZip: '02452', evicted: 'No',
    members: [
      { fullName: 'Jordan Rivera', dob: '1992-06-15' },
      { relationship: 'Partner', fullName: 'Casey Rivera', dob: '1993-02-11' },
      { relationship: 'Child', fullName: 'Sam Rivera', dob: '2018-04-02' },
    ],
  });
  assert.equal(list.length, 2, 'children are not searched');
  assert.equal(list[0].last, 'Rivera');
  assert.equal(list[1].dob, '1993-02-11');
  assert.deepEqual([...list[0].addresses], ['12 Lexington St, Waltham, MA, 02452']);
  assert.match(list[0].selfReport, /"No"/);
  assert.equal(list[1].selfReport, '');
  assert.equal(list[0].ssn, undefined, 'no SSN in court searches');
});

test('Hamilton: the applicant, with present and previous addresses', () => {
  const [p] = subjects('hamilton', { name: 'Jamie Tenant', dob: '1995-04-02', curStreet: '1 Main St', curCity: 'Boston', curState: 'MA', curZip: '02134', prevStreet: '8 Old Rd', prevCity: 'Quincy', prevState: 'MA' });
  assert.equal(p.dob, '1995-04-02');
  assert.equal(p.addresses.length, 2);
});

test('summary counts evictions, landlord judgments and open cases', () => {
  assert.equal(summary(undefined), 'Not checked');
  assert.equal(summary({ status: 'No records found', cases: [] }), 'No records found');
  assert.equal(summary({ status: 'Records found', cases: [
    { type: 'Eviction (summary process)', outcome: 'Judgment for landlord' },
    { type: 'Eviction (summary process)', outcome: 'Dismissed' },
    { type: 'Small claims', outcome: 'Open / pending' },
  ] }), '3 cases found · 2 evictions · 1 judgment for landlord · 1 open');
});

test('court-record printouts stay out of the landlord package unless ticked', () => {
  assert.equal(inPackage({ docType: 'eviction_check' }), false);
  assert.equal(inPackage({ docType: 'eviction_check', inPackage: true }), true);
  assert.equal(inPackage({ docType: 'pay_stubs' }), true);
});
