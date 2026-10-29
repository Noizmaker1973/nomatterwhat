const test = require('node:test');
const assert = require('node:assert');
const csv = require('../src/csv');

test('parses quoted fields with commas, quotes and newlines', () => {
  const { headers, records } = csv.parse('Name,Notes\r\n"Doe, Jane","Says ""hi""\nline 2"\r\nBob,plain\r\n');
  assert.deepStrictEqual(headers, ['Name', 'Notes']);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].Name, 'Doe, Jane');
  assert.strictEqual(records[0].Notes, 'Says "hi"\nline 2');
});

test('detects tab-delimited data pasted from a spreadsheet', () => {
  const { records } = csv.parse('Rent\tBeds\n2500\t2\n');
  assert.deepStrictEqual(records[0], { Rent: '2500', Beds: '2' });
});

test('skips blank rows and strips BOM', () => {
  const { headers, records } = csv.parse('﻿a,b\n1,2\n,\n\n3,4');
  assert.deepStrictEqual(headers, ['a', 'b']);
  assert.strictEqual(records.length, 2);
});

test('stringify round-trips', () => {
  const rows = [{ a: 'x, y', b: ['p', 'q'] }, { a: 'say "hi"', b: null }];
  const { records } = csv.parse(csv.stringify(rows));
  assert.strictEqual(records[0].a, 'x, y');
  assert.strictEqual(records[0].b, 'p; q');
  assert.strictEqual(records[1].a, 'say "hi"');
});
