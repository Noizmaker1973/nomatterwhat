// Merged landlord package: original form + uploads, with images converted to PDF pages.
const { test } = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { buildPackage, fileAsPdf } = require('../lib/package');

const meta = (docType, name, mime, uploadedAt = '2026-10-18T00:00:00Z') => ({ id: name, docType, name, mime, uploadedAt });
// A portrait photo stored sideways with EXIF orientation 6, as phones do.
const sidewaysPhoto = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#3366cc' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

async function twoPagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

test('package = original form pages, then documents in checklist order, with images converted', async () => {
  const files = [
    { meta: meta('pay_stubs', 'stubs.pdf', 'application/pdf'), buffer: await twoPagePdf() },
    { meta: meta('other', 'lease.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), buffer: Buffer.from('not a pdf') },
    { meta: meta('photo_id', 'license.jpg', 'image/jpeg'), buffer: await sidewaysPhoto() },
    { meta: meta('pay_stubs', 'stub3.png', 'image/png'), buffer: await sharp({ create: { width: 300, height: 500, channels: 4, background: '#ffffff00' } }).png().toBuffer() },
    { meta: meta('pay_stubs', 'stub4.webp', 'image/webp'), buffer: await sharp({ create: { width: 500, height: 300, channels: 3, background: '#cc3333' } }).webp().toBuffer() },
    { meta: meta('credit_report', 'credit.pdf', 'application/pdf'), buffer: await twoPagePdf() },
  ];
  const app = { id: 'abc12345', createdAt: '2026-10-18T00:00:00Z', files: files.map((f) => f.meta) };
  const application = { answers: { name: 'Riley Renter' }, signature: { typedName: 'Riley Renter', signedAt: '2026-10-18T00:00:00Z' }, otherSigners: [] };
  const pdf = await buildPackage({ formType: 'standard', applicants: [{ app, application, files }], sheet: {}, agent: null, docLabels: {} });
  const pages = (await PDFDocument.load(pdf)).getPages();

  // 1 form page + license + 2 stub pages + png + webp + docx placeholder; credit report left out by default.
  assert.equal(pages.length, 1 + 1 + 2 + 1 + 1 + 1);
  const size = (i) => pages[i].getSize();
  assert.deepEqual(size(1), { width: 612, height: 792 }, 'sideways photo is turned upright onto a portrait page');
  assert.deepEqual(size(5), { width: 792, height: 612 }, 'landscape image gets a landscape page');

  // Ticking the credit report adds it; unticking the license removes its page.
  files.find((f) => f.meta.docType === 'credit_report').meta.inPackage = true;
  files.find((f) => f.meta.docType === 'photo_id').meta.inPackage = false;
  const custom = await buildPackage({ formType: 'standard', applicants: [{ app, application, files }], sheet: {}, agent: null, docLabels: {} });
  assert.equal((await PDFDocument.load(custom)).getPageCount(), pages.length + 2 - 1);
});

test('a single photo converts to a one-page PDF', async () => {
  const pdf = await fileAsPdf(meta('photo_id', 'id.jpg', 'image/jpeg'), await sidewaysPhoto());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
});

test('PDF text keeps accented letters', () => {
  const { pdfText } = require('../lib/original');
  assert.equal(pdfText('João  Conceição\nAraújo'), 'João Conceição Araújo');
  assert.equal(pdfText('Renée Nuñez Ősz 李'), 'Renée Nuñez Osz', 'other accents are dropped, unsupported letters left out');
});
