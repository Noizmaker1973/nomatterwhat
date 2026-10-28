// Extracting YGL credit-check fields from applications.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ctx = { DRUI: { esc: (s) => String(s) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/ygl.js'), 'utf8'), ctx);
const { people, splitStreet, splitName, bookmarklet } = ctx.DRYGL;

test('street addresses split into number, name and unit', () => {
  assert.deepEqual({ ...splitStreet('12 Lexington St, Apt 2') }, { number: '12', name: 'Lexington St', unit: 'Apt 2' });
  assert.deepEqual({ ...splitStreet('45A Moody Street #3') }, { number: '45A', name: 'Moody Street', unit: '#3' });
  assert.deepEqual({ ...splitStreet('10-12 Main St Unit 4') }, { number: '10-12', name: 'Main St', unit: 'Unit 4' });
  assert.deepEqual({ ...splitStreet('PO Box 5') }, { number: '', name: 'PO Box 5', unit: '' });
});

test('names split into first and last', () => {
  assert.deepEqual({ ...splitName('Jordan Rivera') }, { first: 'Jordan', last: 'Rivera' });
  assert.deepEqual({ ...splitName('Mary Ann Lee Smith Jr') }, { first: 'Mary', last: 'Smith Jr' });
  assert.deepEqual({ ...splitName('Cher') }, { first: 'Cher', last: '' });
});

test('Beantown: every adult household member, sharing the present address', () => {
  const list = people('beantown', {
    curStreet: '12 Lexington St', curCity: 'Waltham', curState: 'MA', curZip: '02452',
    members: [
      { fullName: 'Jordan Rivera', dob: '1992-06-15', ssn: '123-45-6789' },
      { relationship: 'Partner', fullName: 'Casey Rivera', dob: '1993-02-11', ssn: '987-65-4321' },
      { relationship: 'Child', fullName: 'Sam Rivera', dob: '2018-04-02' },
    ],
  });
  assert.equal(list.length, 2, 'the child is left out');
  assert.equal(list[1].first, 'Casey');
  assert.equal(list[1].ssn, '987-65-4321');
  assert.equal(list[1].streetNumber, '12');
  assert.equal(list[1].streetName, 'Lexington St');
  assert.equal(list[1].zip, '02452');
});

test('Standard: the applicant', () => {
  const [p] = people('standard', { name: 'Riley Renter', ssn: '111-22-3333', curStreet: '2 Oak Ave', curCity: 'Marlboro', curState: 'MA', curZip: '01752' });
  assert.equal(p.first, 'Riley');
  assert.equal(p.last, 'Renter');
  assert.equal(p.streetName, 'Oak Ave');
});

test('bookmarklet is a javascript: URL', () => {
  assert.match(bookmarklet(), /^javascript:/);
});
