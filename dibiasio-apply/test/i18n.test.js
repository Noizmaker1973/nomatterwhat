// Every piece of applicant-facing text on a translated form must have a
// Portuguese version, with the same {placeholders}.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I18N = require('../public/js/i18n');
const { FORMS, STATES } = require('../public/js/forms');
const { pdfText } = require('../lib/original');

const PUBLIC = path.join(__dirname, '..', 'public');
const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();

function formStrings(form) {
  const out = [form.title, form.blurb, form.certification, form.authorization];
  const walk = (fields) => fields.forEach((fl) => {
    out.push(fl.label, fl.help, fl.placeholder, fl.addLabel, ...(fl.options || []));
    if (fl.type === 'yesno') out.push('Yes', 'No');
    if (fl.type === 'group') walk(fl.fields);
  });
  form.steps.forEach((s) => { out.push(s.title, s.intro); walk(s.fields); });
  form.documents.forEach((d) => out.push(d.label, d.help));
  return out.filter((s) => s != null && s !== '' && !/^\d+$/.test(s));
}

// t('…'), tIn(x, '…') and both sides of t(c ? '…' : '…') in the applicant pages.
function codeStrings(file) {
  const src = fs.readFileSync(path.join(PUBLIC, 'js', file), 'utf8');
  const out = [];
  const lit = /'((?:[^'\\]|\\.)*)'/g;
  for (const m of src.matchAll(/\b(?:t|tIn)\((.*)/g)) {
    // Read the call's own arguments up to the matching close paren.
    let depth = 1, i = 0, body = '';
    const rest = m[1];
    for (; i < rest.length && depth; i++) {
      const c = rest[i];
      if (c === "'") { const q = rest.slice(i).match(/^'(?:[^'\\]|\\.)*'/); body += q[0]; i += q[0].length - 1; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth) body += c;
    }
    // Stop at the {placeholder values} object.
    const firstObj = body.indexOf('{ ');
    const args = (firstObj >= 0 ? body.slice(0, firstObj) : body).replace(/[=!]==\s*'(?:[^'\\]|\\.)*'/g, '');
    for (const q of args.matchAll(lit)) out.push(q[1].replace(/\\'/g, "'"));
  }
  return out.filter((s) => s && !/^(pt|en)$/.test(s));
}

test('the Beantown application is fully translated into Portuguese', () => {
  const missing = formStrings(FORMS.beantown).concat(['Other']).filter((s) => I18N.PT[s] == null);
  assert.deepEqual(missing, []);
});

test('group item labels are translated', () => {
  I18N.setLang('pt');
  try {
    const members = FORMS.beantown.steps.find((s) => s.id === 'household').fields[0];
    assert.equal(members.itemLabel(0), 'Chefe da família (você)');
    assert.equal(members.itemLabel(2), 'Membro da família 3');
  } finally { I18N.setLang('en'); }
  assert.equal(FORMS.beantown.steps.find((s) => s.id === 'household').fields[0].itemLabel(1), 'Household member 2');
});

test('every string the applicant pages translate has a Portuguese version', () => {
  const files = ['render.js', 'apply.js', 'status.js', 'guarantor.js', 'agent.js'];
  const strings = files.flatMap(codeStrings);
  assert.ok(strings.length > 100, 'found ' + strings.length + ' strings');
  const html = ['apply.html', 'status.html'].flatMap((f) => [...fs.readFileSync(path.join(PUBLIC, f), 'utf8').matchAll(/data-i18n>([^<]+)</g)].map((m) => m[1].trim()));
  const missing = strings.concat(html, ['New', 'In review', 'Docs needed', 'Sent to landlord', 'Approved', 'Denied', 'Lease signed', 'Withdrawn'])
    .filter((s) => I18N.PT[s] == null && !s.includes('Hamilton'));
  // Text that only appears on forms without a translation is allowed to stay English.
  const englishOnly = ['Authorization to release information', 'Each adult who will live in the apartment fills out their own application. After you submit, you\'ll get a link to share with your roommates or co-applicants.',
    'I authorize Dibiasio Realty, the landlord/management company, and their screening provider to obtain my consumer credit report', ' and a Criminal Offender Record Information (CORI) report', ' and to verify the information in this application, including with my landlords and employers.'];
  assert.deepEqual([...new Set(missing.filter((s) => !englishOnly.includes(s)))], []);
});

test('translations keep the same {placeholders}', () => {
  const bad = Object.entries(I18N.PT).filter(([en, pt]) => holes(en) !== holes(pt)).map(([en]) => en);
  assert.deepEqual(bad, []);
});

test('t() fills placeholders and falls back to English', () => {
  assert.equal(I18N.tIn('pt', 'Step {n} of {total}', { n: 2, total: 9 }), 'Etapa 2 de 9');
  assert.equal(I18N.tIn('en', 'Step {n} of {total}', { n: 2, total: 9 }), 'Step 2 of 9');
  assert.equal(I18N.tIn('pt', 'Untranslated text'), 'Untranslated text');
  assert.equal(I18N.t('Yes'), 'Yes', 'English by default');
  assert.ok(STATES.includes('Other'));
});

test('PDF text keeps Portuguese accents', () => {
  assert.equal(pdfText('João  Conceição\nAraújo'), 'João Conceição Araújo');
  assert.equal(pdfText('Renée Nuñez Ősz 李'), 'Renée Nuñez Osz', 'other accents are dropped, unsupported letters left out');
  assert.equal(pdfText('Zoë – “quoted”'), 'Zoë – “quoted”');
});
