// Fills the landlords' original paper forms (templates/*.pdf) with an
// applicant's answers, so agents can hand over the exact form the landlord
// asked for. The PDFs have no form fields, so each value is drawn at the
// position of its blank. Positions are in PDF points measured from the TOP of
// the page (as pdftotext reports them) and flipped when drawn.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const INK = rgb(0.05, 0.12, 0.45);
const TEMPLATES = path.join(__dirname, '..', 'templates');

const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; };
const money = (v) => (v == null || String(v).trim() === '' ? '' : num(v).toLocaleString('en-US', { minimumFractionDigits: num(v) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.slice(5, 7) + '/' + v.slice(8, 10) + '/' + v.slice(0, 4) : v || '');
const today = (iso) => date(String(iso || new Date().toISOString()).slice(0, 10));
const join = (...parts) => parts.filter((p) => p != null && String(p).trim() !== '').join(', ');
const yes = (v) => v === 'Yes';
const has = (app, docType) => app.files.some((f) => f.docType === docType);

/* ----------------------------- field maps ------------------------------ */
// Each map returns a list of drawing ops:
//   { p, x, y, t, w }        text on page p (1-based), baseline y, max width w
//   { p, x, y, mark: true }  an X centred on (x, y)
//   { p, x, y, circle: [rx, ry] }  an ellipse around a printed word
//   { p, x, y, w, h, sig: true }   the signature image in that box (top-left x, y)

function beantown({ a, sig, sheet, app, otherSigners }) {
  const ops = [];
  const t = (p, x, y, text, w) => ops.push({ p, x, y, t: text, w });
  const mark = (p, x, y, on) => on && ops.push({ p, x, y, mark: true });

  // Page 1
  t(1, 101, 174, date(sheet.dateReceived) || today(app.createdAt), 70);
  t(1, 103, 195, sheet.timeReceived || new Date(app.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }), 70);
  t(1, 130, 269, a.name, 355);
  t(1, 133, 293, a.phone, 335);
  t(1, 77, 317, a.email, 425);
  t(1, 134, 338, a.curStreet, 160);
  t(1, 299, 338, a.curCity, 100);
  t(1, 403, 338, a.curState, 55);
  t(1, 461, 338, a.curZip, 60);
  const sizes = { Studio: 76.6, 'One bedroom': 180.6, 'Two bedroom': 286.7, 'Three bedroom': 398.9, 'Four bedroom': 498.1 };
  if (sizes[a.preferredSize]) mark(1, sizes[a.preferredSize], 413.5, true);
  mark(1, 205.3, 439.5, yes(a.mobileVoucher));
  mark(1, 255.7, 439.5, a.mobileVoucher === 'No');
  t(1, 432, 444, a.housingAuthority, 130);
  t(1, 164, 470, money(a.currentRent), 75);
  mark(1, 437.3, 465.5, yes(a.rentIncludesUtilities));
  mark(1, 478.1, 465.5, a.rentIncludesUtilities === 'No');
  t(1, 287, 495, a.timeAtAddress, 118);
  const reason = String(a.reasonForMoving || '');
  t(1, 38, 536, reason.slice(0, 110), 485);
  t(1, 38, 554, reason.slice(110, 220), 485);

  // Household: member 1 on page 1, members 2-6 on page 2.
  const members = a.members || [];
  const member = (m, p, top, withRelationship) => {
    if (!m) return;
    if (withRelationship) t(p, 275, top - 3.5, m.relationship, 210);
    t(p, 132, top + 12.5, m.fullName, 360);
    t(p, 146, top + 28.5, date(m.dob), 345);
    t(p, 109, top + 44.5, m.email, 385);
    t(p, 154, top + 60.5, m.phone, 335);
    t(p, 101, top + 76.5, m.ssn, 80);
    mark(p, 185, top + 88.5, yes(m.student));
    mark(p, 250.6, top + 88.5, m.student === 'No');
  };
  member(members[0], 1, 650.5, false);
  [147.1, 272.5, 400.1, 527.6, 655.3].forEach((top, i) => member(members[i + 1], 2, top, true));

  // Page 3: references and employment
  t(3, 222, 208, a.presLandlordName, 158);
  t(3, 440, 208, a.presLandlordPhone, 120);
  t(3, 85, 224, a.presLandlordAddress, 470);
  t(3, 222, 250, a.formLandlordName, 144);
  t(3, 429, 250, a.formLandlordPhone, 130);
  t(3, 85, 266, a.formLandlordAddress, 470);
  (a.charRefs || []).slice(0, 2).forEach((r, i) => {
    const dy = i * 71.3;
    t(3, 196, 380 + dy, r.name, 142);
    t(3, 403, 380 + dy, r.phone, 150);
    t(3, 85, 396 + dy, r.address, 470);
    t(3, 257, 412 + dy, r.howLong, 135);
  });
  (a.employment || []).slice(0, 2).forEach((j, i) => {
    const dy = i * 114.5;
    t(3, 217, 552 + dy, j.member, 200);
    t(3, 181, 572 + dy, j.employer, 380);
    t(3, 112, 593 + dy, j.position, 440);
    t(3, 176, 613 + dy, money(j.monthlySalary), 120);
    t(3, 314, 634 + dy, money(j.taxIncome), 70);
    t(3, 447, 634 + dy, j.taxYear, 57);
  });

  // Page 4: other income, questions, signatures
  (a.otherIncome || []).slice(0, 3).forEach((o, i) => {
    const y = 249 + i * 19;
    t(4, 40, y, o.member, 170);
    t(4, 218, y, o.type, 130);
    t(4, 352, y, '$' + money(o.amount), 80);
    t(4, 460, y, String(o.per || 'per month').replace(/^per /, ''), 57);
  });
  mark(4, 441, 341, yes(a.felony));
  mark(4, 472.5, 341, a.felony === 'No');
  mark(4, 366, 358.9, yes(a.evicted));
  mark(4, 401.8, 358.9, a.evicted === 'No');
  mark(4, 150, 376.8, yes(a.hasPet));
  mark(4, 185.9, 376.8, a.hasPet === 'No');
  if (a.petDetails) t(4, 214, 381, '(' + a.petDetails + ')', 350);
  ops.push({ p: 4, x: 190, y: 524, w: 210, h: 22, sig: true });
  t(4, 437, 545, today(sig.signedAt), 62);
  otherSigners.slice(0, 3).forEach((s, i) => {
    t(4, 200, 566 + i * 20.7, s.name + ' (e-signed)', 205);
    t(4, 440, 566 + i * 20.7, today(sig.signedAt), 60);
  });
  return ops;
}

function hamilton({ a, sig, sheet, app, agent, form }) {
  const ops = [];
  const t = (p, x, y, text, w, size) => ops.push({ p, x, y, t: text, w, size });
  const mark = (p, x, y, on) => on && ops.push({ p, x, y, mark: true });
  const circle = (p, x, y, on, rx = 14) => on && ops.push({ p, x, y, circle: [rx, 7] });

  // Page 1: application checklist
  const student = a.applicantType === 'Student';
  mark(1, 48.5, 230.5, true);
  mark(1, 48.5, 272.5, true);
  mark(1, 48.5, 329.5, has(app, 'pay_stubs'));
  mark(1, 48.5, 398.5, student && has(app, 'student_verification'));
  mark(1, 48.5, 465.5, has(app, 'photo_id'));
  mark(1, 48.5, 507.5, has(app, 'guarantor'));
  mark(1, 81.5, 528.5, num(a.pets) > 0);
  const freeRent = sheet.freeRent;
  mark(1, 51.5, 556.5, Boolean(freeRent));
  circle(1, 330.5, 556.5, freeRent === 'Yes');
  circle(1, 436, 556.5, freeRent === 'No', 12);
  mark(1, 51.5, 573.5, Boolean(sheet.freeRentAmount));
  t(1, 249, 577, money(sheet.freeRentAmount), 65);
  t(1, 388, 577, sheet.freeRentMonths, 40);
  mark(1, 51.5, 589, Boolean(sheet.transfer));
  circle(1, 336.5, 589, sheet.transfer === 'Yes');
  circle(1, 439, 589, sheet.transfer === 'No', 12);
  circle(1, 128, 614, true, 19); // "applicant" in "rental agent / applicant [select one]"
  ops.push({ p: 1, x: 30, y: 652, w: 170, h: 22, sig: true });
  t(1, 460, 665, today(sig.signedAt), 80);

  // Page 2: lease application
  const small = 8;
  t(2, 22, 123, a.name, 270);
  t(2, 300, 121, a.phone, 180);
  t(2, 22, 152, date(a.dob), 110);
  t(2, 160, 152, a.ssn, 130);
  t(2, 470, 152, a.itin, 110);
  t(2, 25, 181, a.email, 260);
  t(2, 300, 178, a.leaseInName, 160);
  t(2, 22, 202, join(a.curStreet, a.curCity, [a.curState, a.curZip].filter(Boolean).join(' ')), 270, small);
  t(2, 300, 202, a.curLandlord, 135, small);
  t(2, 340, 213, a.curLandlordPhone, 95, small);
  t(2, 463, 202, date(a.curFrom), 48, 7);
  t(2, 524, 202, date(a.curTo) || a.curTo, 55, 7);
  t(2, 500, 217, money(a.curRent) && '$' + money(a.curRent), 75, small);
  t(2, 22, 236, join(a.prevStreet, a.prevCity, [a.prevState, a.prevZip].filter(Boolean).join(' ')), 270, small);
  t(2, 300, 233, a.prevLandlord, 135, small);
  t(2, 340, 244, a.prevLandlordPhone, 95, small);
  t(2, 463, 235, date(a.prevFrom), 46, 7);
  t(2, 522, 235, date(a.prevTo), 55, 7);
  t(2, 500, 251, money(a.prevRent) && '$' + money(a.prevRent), 75, small);
  t(2, 135, 258, a.hearAbout, 300, small);
  t(2, 22, 296, a.occupation, 125, small);
  t(2, 155, 296, a.company, 150, small);
  t(2, 312, 296, a.employerContact, 270, small);
  t(2, 22, 322, date(a.hireDate), 68, small);
  t(2, 95, 322, money(a.monthlySalary) && '$' + money(a.monthlySalary), 95, small);
  t(2, 197, 322, money(a.otherIncome) && '$' + money(a.otherIncome), 195, small);
  t(2, 400, 322, a.otherIncomeContact, 180, small);
  if (student) {
    t(2, 22, 358, a.school, 170, small);
    t(2, 197, 358, a.schoolId, 100, small);
    t(2, 305, 358, a.schoolAddress, 280, small);
    t(2, 22, 383, a.program, 92, small);
    t(2, 118, 383, a.gradYear, 70, small);
    t(2, 197, 383, a.enrollment, 180, small);
    t(2, 392, 383, a.registrarPhone, 190, small);
  }
  t(2, 22, 415, a.emergencyName, 165, small);
  t(2, 191, 415, a.emergencyAddress, 265, small);
  t(2, 465, 415, a.emergencyPhone, 120, small);
  t(2, 22, 448, a.children || 'None', 350, small);
  mark(2, 428, 447, yes(a.childrenUnder7));
  mark(2, 485, 447, a.childrenUnder7 === 'No');
  t(2, 22, 474, a.coTenants || 'None', 560, small);
  t(2, 22, 499, a.aptAddress, 270, small);
  t(2, 300, 499, a.bedrooms, 60, small);
  t(2, 368, 499, a.occupants, 90, small);
  t(2, 470, 499, a.pets, 100, small);
  t(2, 40, 529, date(a.occFrom), 65, small);
  t(2, 120, 529, date(a.occTo), 175, small);
  t(2, 300, 529, a.leaseMonths, 60, small);
  t(2, 368, 529, date(sheet.rentBegins) || date(a.occFrom), 200, small);
  // Office use / payments, from the agent's deal sheet
  t(2, 58, 557, sheet.pcReview, 245, 7);
  t(2, 311, 557, money(sheet.depositCollected) && '$' + money(sheet.depositCollected), 50, 7);
  t(2, 58, 597, sheet.managerReview, 245, 7);
  t(2, 105, 615, money(sheet.commission) && '$' + money(sheet.commission), 75, 7);
  t(2, 228, 615, money(sheet.finalRent), 75, 7);
  t(2, 526, 564, money(sheet.firstMonth || sheet.rent), 60, small);
  t(2, 526, 580, money(sheet.lastMonth), 60, small);
  t(2, 526, 596, money(sheet.securityDeposit), 60, small);
  const due = num(sheet.firstMonth || sheet.rent) + num(sheet.lastMonth) + num(sheet.securityDeposit) - num(sheet.depositCollected);
  t(2, 526, 611, due ? money(due) : '', 60, small);
  ops.push({ p: 2, x: 128, y: 748, w: 195, h: 22, sig: true });
  t(2, 488, 763, today(sig.signedAt), 80);

  // Page 3: verification request
  t(3, 136, 105, a.name, 232);
  ops.push({ p: 3, x: 142, y: 150, w: 200, h: 22, sig: true });
  t(3, 400, 171, today(sig.signedAt), 100);
  t(3, 35, 247, a.name, 160);
  t(3, 473, 288, agent ? agent.name : '', 110);
  t(3, 116, 400, sheet.refTenantAddress || join(a.curStreet, a.curCity), 450);
  t(3, 130, 413, sheet.refDates || [date(a.curFrom), a.curTo || 'present'].filter(Boolean).join(' - '), 430);
  t(3, 110, 427, money(sheet.refRent || a.curRent) && '$' + money(sheet.refRent || a.curRent), 135);
  t(3, 352, 427, sheet.refOnTime, 220);
  t(3, 190, 441, sheet.refReRent, 380);
  t(3, 104, 455, sheet.refProblems, 470);
  t(3, 150, 469, sheet.refBy, 420);
  t(3, 99, 558, agent ? agent.name : '', 220);
  t(3, 368, 558, 'Dibiasio Realty', 200);
  return ops;
}

function standard({ a, sig, sheet, app }) {
  const ops = [];
  const s = 8;
  const t = (x, y, text, w, size = s) => ops.push({ p: 1, x, y, t: text, w, size });
  const initials = String(a.name || '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('');

  t(449, 31, [sheet.address || a.aptAddress, sheet.unit && 'Unit ' + sheet.unit].filter(Boolean).join(', '), 120, 7);
  t(415, 79, today(app.createdAt), 80);
  t(500, 79, app.id.slice(0, 8).toUpperCase(), 90);
  // Each row's value sits on the underscore line just above its labels.
  t(19, 103, a.name, 222); t(248, 103, a.phone, 170); t(424, 103, yes(a.over18) ? initials : '', 140);
  t(19, 127, a.curStreet, 222); t(424, 127, date(a.curFrom), 68); t(496, 127, a.curTo || 'Present', 68);
  t(19, 151, a.curCity, 86); t(109, 151, a.curState, 76); t(190, 151, a.curZip, 54);
  t(248, 151, [a.carMakeYear, a.carPlate].filter(Boolean).join(' / '), 192); t(446, 151, a.ssn, 118);
  t(19, 175, a.presLandlord, 166); t(190, 175, a.presLandlordAddress, 250); t(446, 175, a.presLandlordPhone, 118);
  t(19, 199, a.formLandlord, 166); t(190, 199, a.formOccupancy, 126); t(320, 199, a.formLandlordAddress, 122); t(446, 199, a.formLandlordPhone, 118);
  t(19, 223, a.employer, 166); t(190, 223, a.employerAddress, 250); t(446, 223, a.employerPhone, 118);
  t(19, 247, a.occupation, 166); t(190, 247, a.businessType, 126);
  t(320, 247, money(a.salary) && '$' + money(a.salary) + ' ' + String(a.salaryPer || '').replace('every 2 weeks', 'biweekly'), 122); t(446, 247, a.employmentLength, 118);
  t(19, 271, a.formEmployer, 166); t(190, 271, a.formEmploymentLength, 126); t(320, 271, a.formEmployerAddress, 122); t(446, 271, a.formEmployerPhone, 118);
  t(19, 295, a.refName, 166); t(190, 295, a.refAddress, 250); t(446, 295, a.refPhone, 118);
  t(19, 319, a.emergencyName, 166); t(190, 319, a.emergencyAddress, 250); t(446, 319, a.emergencyPhone, 118);
  t(19, 343, a.creditRef, 166); t(190, 343, a.creditRefAddress, 250); t(446, 343, a.creditRefPhone, 118);
  t(19, 367, a.checkingBank, 166); t(190, 367, a.checkingBranch, 250); t(446, 367, a.checkingLast4 && 'xxxx' + a.checkingLast4, 118);
  t(19, 391, a.savingsBank, 166); t(190, 391, a.savingsBranch, 250); t(446, 391, a.savingsLast4 && 'xxxx' + a.savingsLast4, 118);
  t(19, 415, a.coTenants, 385);
  t(19, 439, a.aptUnit, 95); t(118, 439, a.occupants, 115); t(239, 439, a.adults, 68); t(311, 439, a.pets, 60);
  t(19, 463, a.aptAddress, 166); t(190, 463, a.minors, 180);
  t(19, 487, a.aptCity, 166); t(190, 487, date(a.occupancyDate), 115); t(311, 487, date(a.rentBegins), 60);
  t(19, 511, a.leaseMonths, 166); t(190, 511, date(a.leaseFrom), 115); t(311, 511, date(a.leaseTo), 60);
  t(175, 543, a.felony === 'Yes' ? 'Y' : a.felony === 'No' ? 'N' : '', 22);
  if (a.felony === 'Yes' && a.felonyDetail) t(19, 562, 'Conviction details: ' + a.felonyDetail, 390, 7);
  // Deal terms column, from the agent's deal sheet
  t(466, 433, money(sheet.brokerFee), 55);
  t(496, 446, money(sheet.rent), 95);
  t(522, 465, money(sheet.otherMonthly), 70);
  t(456, 494, money(sheet.keyLock), 135);
  t(491, 503, money(sheet.lastMonth), 100);
  t(482, 513, money(sheet.securityDeposit), 110);
  t(489, 522, money(sheet.depositOnAccount || sheet.depositCollected), 102);
  t(492, 542, money(sheet.balanceOnAcceptance), 100);
  t(280, 677, date(sheet.ownerDeadline), 310);
  ops.push({ p: 1, x: 382, y: 693, w: 205, h: 18, sig: true });
  return ops;
}

// The Guarantor Form is a one-page scan; positions were measured on its underlines.
// The notary block is left blank for the landlord to complete if they want it.
function guarantor({ a, sig, sheet }) {
  const ops = [];
  const t = (x, y, text, w, size = 10) => ops.push({ p: 1, x, y, t: text, w, size });
  const premises = sheet.address ? [sheet.address, sheet.unit && 'Unit ' + sheet.unit, sheet.city].filter(Boolean).join(', ') : a.aptAddress;
  const salary = money(a.salary) && '$' + money(a.salary) + ' ' + String(a.salaryPer || '').replace('every 2 weeks', 'biweekly');
  t(124, 143, premises, 296);
  t(118, 164, a.name, 268);
  t(104, 185, [a.curCity, a.curState].filter(Boolean).join(', '), 152);
  t(300, 226, a.tenantName, 112);
  ops.push({ p: 1, x: 300, y: 244, w: 170, h: 22, sig: true });
  // Guarantor's credit information
  t(186, 512, a.name, 172); t(382, 512, a.ssn, 92);
  t(146, 527, a.tenantName, 328);
  t(196, 540, a.relationship, 280);
  t(198, 554, a.curStreet, 280);
  t(198, 567, [a.curCity, a.curState, a.curZip].filter(Boolean).join(', '), 280);
  t(198, 581, a.phone, 210);
  t(200, 594, a.employer, 276);
  t(198, 608, a.employerAddress, 278);
  t(204, 622, a.employerPhone, 210);
  t(136, 635, a.position, 186); t(388, 635, a.howLong, 90);
  t(126, 649, salary, 150, 9);
  t(366, 649, [money(a.otherIncome) && '$' + money(a.otherIncome) + '/mo', a.otherIncomeSource].filter(Boolean).join(' '), 116, 8);
  return ops;
}

const MAPS = { beantown, hamilton, standard, guarantor };

/* ------------------------------- drawing ------------------------------- */
// The built-in Helvetica only has Western European letters (WinAnsi), so keep
// accents like ã, ç, é; other accented letters lose the accent (ő → o) and
// anything else is left out.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function pdfText(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, (c) => (WIN_ANSI_EXTRA.includes(c) ? c
    : c.normalize('NFD').replace(/[^\x20-\x7E\xA0-\xFF]/g, ''))).replace(/ {2,}/g, ' ').trim();
}

async function fillOriginal({ formType, app, application, sheet, agent }) {
  const map = MAPS[formType];
  if (!map) throw new Error('No original form for ' + formType);
  const doc = await PDFDocument.load(fs.readFileSync(path.join(TEMPLATES, formType + '.pdf')));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const sig = application.signature || {};
  let sigImage = null;
  if (/^data:image\/png;base64,/.test(sig.image || '')) {
    try { sigImage = await doc.embedPng(Buffer.from(sig.image.split(',')[1], 'base64')); } catch { sigImage = null; }
  }

  const ops = map({ a: application.answers || {}, sig, sheet: sheet || {}, app, agent, otherSigners: application.otherSigners || [] });
  for (const op of ops) {
    const page = pages[op.p - 1];
    if (!page) continue;
    const H = page.getHeight();
    if (op.mark) {
      const d = 3.6;
      page.drawLine({ start: { x: op.x - d, y: H - op.y - d }, end: { x: op.x + d, y: H - op.y + d }, thickness: 1.4, color: INK });
      page.drawLine({ start: { x: op.x - d, y: H - op.y + d }, end: { x: op.x + d, y: H - op.y - d }, thickness: 1.4, color: INK });
    } else if (op.circle) {
      page.drawEllipse({ x: op.x, y: H - op.y, xScale: op.circle[0], yScale: op.circle[1], borderColor: INK, borderWidth: 1 });
    } else if (op.sig) {
      if (sigImage) {
        const scale = Math.min(op.w / sigImage.width, op.h / sigImage.height);
        page.drawImage(sigImage, { x: op.x, y: H - op.y - op.h, width: sigImage.width * scale, height: sigImage.height * scale });
      } else if (sig.typedName) {
        page.drawText('/s/ ' + pdfText(sig.typedName), { x: op.x, y: H - op.y - op.h + 4, size: 10, font, color: INK });
      }
    } else {
      let text = pdfText(op.t);
      if (!text) continue;
      let size = op.size || 9;
      const max = op.w || 200;
      while (size > 5.5 && font.widthOfTextAtSize(text, size) > max) size -= 0.5;
      while (text.length > 1 && font.widthOfTextAtSize(text, size) > max) text = text.slice(0, -1);
      // Sit 2pt above the measured baseline so descenders clear the printed underline.
      page.drawText(text, { x: op.x, y: H - op.y + 2, size, font, color: INK });
    }
  }
  return Buffer.from(await doc.save());
}

module.exports = { fillOriginal, pdfText };
