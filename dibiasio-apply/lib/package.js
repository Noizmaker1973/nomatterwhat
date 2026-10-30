// Builds one PDF for the landlord: each applicant's original form followed by
// their uploaded documents. Uploaded PDFs are copied page by page; photos are
// turned upright (phone EXIF orientation), downsized, and placed on their own
// page. Files that can't be converted (Word documents, protected PDFs) get a
// placeholder page so nothing silently goes missing.
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { fillOriginal, pdfText } = require('./original');

const LETTER = [612, 792];
const MARGIN = 36;
const DOC_ORDER = ['photo_id', 'pay_stubs', 'tax_return', 'other_income', 'student_verification', 'guarantor', 'pet_docs', 'reference_letter', 'other', 'credit_report', 'eviction_check'];
// Agents tick which uploads go into the merged PDF; credit reports start out
// excluded because landlords usually get them from the screening company.
// Screening results (credit report, court-records printouts) stay out unless the agent ticks them.
const PRIVATE_DOCS = ['credit_report', 'eviction_check'];
const inPackage = (meta) => (typeof meta.inPackage === 'boolean' ? meta.inPackage : !PRIVATE_DOCS.includes(meta.docType));
const rank = (docType) => { const i = DOC_ORDER.indexOf(docType); return i < 0 ? DOC_ORDER.length : i; };

// Any image → upright JPEG at most 2000px on its long side.
async function toJpeg(buffer, mime) {
  let input = buffer;
  if (/hei[cf]/.test(mime)) {
    try {
      return await sharp(buffer).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    } catch {
      // Prebuilt sharp can't decode HEVC-based HEIC photos; fall back to the wasm decoder.
      input = Buffer.from(await heicConvert({ buffer, format: 'JPEG', quality: 0.9 }));
    }
  }
  return sharp(input, { animated: false }).rotate().flatten({ background: '#ffffff' })
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

async function addImage(doc, buffer, mime) {
  const jpg = await doc.embedJpg(await toJpeg(buffer, mime));
  // Landscape photos (e.g. a driver's license) go on a landscape page.
  const [w, h] = jpg.width > jpg.height ? [LETTER[1], LETTER[0]] : LETTER;
  const page = doc.addPage([w, h]);
  const scale = Math.min((w - 2 * MARGIN) / jpg.width, (h - 2 * MARGIN) / jpg.height, 1.5);
  const dw = jpg.width * scale;
  const dh = jpg.height * scale;
  page.drawImage(jpg, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
}

async function addPdf(doc, buffer) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = await doc.copyPages(src, src.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
}

async function addPlaceholder(doc, font, title, lines) {
  const page = doc.addPage(LETTER);
  page.drawText(title, { x: MARGIN, y: LETTER[1] - 100, size: 16, font, color: rgb(0.1, 0.18, 0.35) });
  lines.forEach((line, i) => page.drawText(line, { x: MARGIN, y: LETTER[1] - 130 - i * 18, size: 11, font, color: rgb(0.3, 0.3, 0.3) }));
}

const ascii = (s) => pdfText(s || '') || '?';

// Converts one stored file into PDF pages appended to `doc`.
async function addFile(doc, font, meta, buffer, label) {
  try {
    if (meta.mime === 'application/pdf') return await addPdf(doc, buffer);
    if (meta.mime.startsWith('image/')) return await addImage(doc, buffer, meta.mime);
  } catch (e) {
    console.error('[package] could not convert %s: %s', meta.name, e.message);
  }
  await addPlaceholder(doc, font, ascii(label) + ': ' + ascii(meta.name), [
    'This file could not be converted to PDF automatically' + (/word/.test(meta.mime) ? ' (Word document).' : '.'),
    'Download it separately from the agent dashboard.',
  ]);
}

/**
 * applicants: [{ app, application, files: [{ meta, buffer }] }]
 * Only files the agent left ticked (see inPackage) are appended.
 */
async function buildPackage({ formType, applicants, sheet, agent, docLabels }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const { app, application, files } of applicants) {
    // Each applicant's own form: a deal can mix tenants and guarantors.
    const form = await PDFDocument.load(await fillOriginal({ formType: app.formType || formType, app, application, sheet, agent }));
    (await doc.copyPages(form, form.getPageIndices())).forEach((p) => doc.addPage(p));
    const ordered = files
      .filter(({ meta }) => inPackage(meta))
      .sort((a, b) => rank(a.meta.docType) - rank(b.meta.docType) || a.meta.uploadedAt.localeCompare(b.meta.uploadedAt));
    for (const { meta, buffer } of ordered) await addFile(doc, font, meta, buffer, docLabels[meta.docType] || 'Document');
  }
  return Buffer.from(await doc.save());
}

// A single upload as a PDF (images converted, PDFs passed through).
async function fileAsPdf(meta, buffer) {
  if (meta.mime === 'application/pdf') return buffer;
  const doc = await PDFDocument.create();
  await addFile(doc, await doc.embedFont(StandardFonts.Helvetica), meta, buffer, 'Document');
  return Buffer.from(await doc.save());
}

module.exports = { buildPackage, fileAsPdf, inPackage };
