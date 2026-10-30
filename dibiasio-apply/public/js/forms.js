/*
 * Application definitions for the Dibiasio Realty application portal.
 *
 * Each form is pure data: steps -> fields. The same definitions drive the
 * applicant wizard (apply.js), the agent dashboard (agent.js), the printable
 * copy (print.js) and server-side validation (server.js).
 *
 * Field keys:
 *   k         answer key (unique within its step / group)
 *   type      text | email | tel | date | money | number | ssn | state | select |
 *             radio | yesno | textarea | heading | note | group
 *   w         width on desktop: 'full' (default), 'half', 'third', 'quarter'
 *   req       required
 *   showIf    { k, eq } — only show when another answer in the same scope equals eq
 *   deal      property key; prefilled (and locked) from the agent's applicant link
 *   sensitive encrypted like everything else, but never saved to the browser draft
 */
(function (root) {
  const STATES = ['MA', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'Other'];

  // Small builders keep the definitions readable.
  const f = (k, label, type = 'text', extra = {}) => Object.assign({ k, label, type }, extra);
  const half = (k, label, type, extra = {}) => f(k, label, type, Object.assign({ w: 'half' }, extra));
  const third = (k, label, type, extra = {}) => f(k, label, type, Object.assign({ w: 'third' }, extra));
  const heading = (label, help) => ({ type: 'heading', label, help });
  const note = (label) => ({ type: 'note', label });
  const address = (prefix, label, req) => [
    f(prefix + 'Street', label ? label + ' – street address' : 'Street address', 'text', { req, autocomplete: 'street-address' }),
    third(prefix + 'City', 'City', 'text', { req }),
    third(prefix + 'State', 'State', 'state', { req }),
    third(prefix + 'Zip', 'ZIP code', 'text', { req, inputmode: 'numeric', maxlength: 10 }),
  ];

  const MONEY_PERIODS = ['per month', 'per week', 'every 2 weeks', 'per year'];

  // Documents that every application asks for in some form.
  // Blank guarantor form, offered on every application.
  const GUARANTOR_URL = '/forms/guarantor-form.pdf';
  const GUARANTOR_STEPS = 'Download the form, have your guarantor fill it out and sign it, then upload it here.';
  const DOC_GUARANTOR = { id: 'guarantor', label: 'Guarantor form', help: 'Only if you\'re using a guarantor. ' + GUARANTOR_STEPS, download: GUARANTOR_URL };

  const DOC_ID = { id: 'photo_id', label: 'Photo ID', help: 'Driver\'s license preferred, or passport / state ID. One for every adult. A clear phone photo is fine.', req: true };

  const FORMS = {
    /* ------------------------------------------------------------------ */
    beantown: {
      id: 'beantown',
      name: 'Beantown Companies',
      short: 'Beantown',
      title: 'Beantown Companies Rental Application',
      blurb: 'Use this for apartments managed by Beantown Companies (Waltham & Marlboro). One application covers your whole household.',
      contact: '100 Felton Street, Suite 201, Waltham, MA 02453 · 617-782-7800 | 34 Main Street, Marlboro, MA 01752 · 508-251-0412',
      minutes: 15,
      incomeMultiple: 3,
      steps: [
        {
          id: 'applicant', title: 'About you',
          intro: 'Start with your contact information and where you live now.',
          fields: [
            f('name', 'Full legal name', 'text', { req: true, autocomplete: 'name' }),
            half('phone', 'Phone', 'tel', { req: true }),
            half('email', 'Email', 'email', { req: true }),
            heading('Present address'),
            ...address('cur', '', true),
            half('currentRent', 'Current rent / month', 'money'),
            half('rentIncludesUtilities', 'Does that include utilities?', 'yesno'),
            half('timeAtAddress', 'How long have you lived there?', 'text', { placeholder: 'e.g. 2 years, 3 months' }),
            f('reasonForMoving', 'Why are you moving?', 'textarea'),
          ],
        },
        {
          id: 'apartment', title: 'Apartment',
          intro: 'Tell us what you are looking for.',
          fields: [
            f('aptAddress', 'Apartment you are applying for (if known)', 'text', { deal: 'address' }),
            f('preferredSize', 'Preferred size of apartment', 'radio', { req: true, options: ['Studio', 'One bedroom', 'Two bedroom', 'Three bedroom', 'Four bedroom'], deal: 'bedrooms' }),
            half('mobileVoucher', 'Do you have a mobile housing voucher?', 'yesno', { req: true }),
            half('housingAuthority', 'Which housing authority?', 'text', { showIf: { k: 'mobileVoucher', eq: 'Yes' } }),
          ],
        },
        {
          id: 'household', title: 'Household',
          intro: 'List everyone who will live in the apartment, starting with yourself.',
          fields: [
            {
              k: 'members', type: 'group', min: 1, max: 6, label: 'Household members',
              itemLabel: (i) => (i === 0 ? 'Head of household (you)' : 'Household member ' + (i + 1)),
              addLabel: 'Add another person',
              fields: [
                f('relationship', 'Relationship to head of household', 'text', { hideFirst: true, placeholder: 'e.g. Spouse, Child, Roommate' }),
                half('fullName', 'Full name', 'text', { req: true }),
                half('dob', 'Date of birth', 'date', { req: true }),
                half('email', 'Email', 'email'),
                half('phone', 'Phone', 'tel'),
                half('ssn', 'Social Security number', 'ssn', { help: 'Adults only. Leave blank for minors.' }),
                half('student', 'Full-time student?', 'yesno'),
              ],
            },
          ],
        },
        {
          id: 'references', title: 'References',
          intro: 'Landlords or housing officials from places you\'ve lived in the last five years. No landlord history? Give two character references (known 1+ year, not related to you).',
          fields: [
            heading('Present landlord'),
            half('presLandlordName', 'Name', 'text'),
            half('presLandlordPhone', 'Phone', 'tel'),
            f('presLandlordAddress', 'Address', 'text'),
            heading('Former landlord'),
            half('formLandlordName', 'Name', 'text'),
            half('formLandlordPhone', 'Phone', 'tel'),
            f('formLandlordAddress', 'Address', 'text'),
            heading('Character references', 'Required if you can\'t provide landlord references.'),
            {
              k: 'charRefs', type: 'group', min: 0, max: 2, label: 'Character references',
              itemLabel: (i) => 'Character reference ' + (i + 1), addLabel: 'Add a character reference',
              fields: [
                half('name', 'Name', 'text', { req: true }),
                half('phone', 'Phone', 'tel', { req: true }),
                f('address', 'Address', 'text'),
                f('howLong', 'How long have you known this person?', 'text', { placeholder: 'e.g. 4 years' }),
              ],
            },
          ],
        },
        {
          id: 'income', title: 'Income',
          intro: 'Employment and any other income for everyone in the household.',
          fields: [
            {
              k: 'employment', type: 'group', min: 0, max: 6, label: 'Employment',
              itemLabel: (i) => 'Job ' + (i + 1), addLabel: 'Add a job',
              fields: [
                f('member', 'Household member', 'text', { req: true, placeholder: 'Who works here?' }),
                half('employer', 'Present employer', 'text', { req: true }),
                half('position', 'Position held', 'text'),
                half('monthlySalary', 'Current monthly salary (gross)', 'money', { req: true }),
                third('taxIncome', 'Last year\'s 1040 total income', 'money'),
                third('taxYear', 'Tax year', 'number', { placeholder: String(new Date().getFullYear() - 1) }),
              ],
            },
            heading('Other income', 'Welfare, Social Security, SSI, pension, disability, unemployment, alimony, child support, dividends, rental income, military pay, scholarships, grants, etc.'),
            {
              k: 'otherIncome', type: 'group', min: 0, max: 8, label: 'Other income',
              itemLabel: (i) => 'Other income ' + (i + 1), addLabel: 'Add other income',
              fields: [
                third('member', 'Household member', 'text', { req: true }),
                third('type', 'Type of income', 'text', { req: true }),
                third('amount', 'Gross amount (before taxes)', 'money', { req: true }),
                third('per', 'How often', 'select', { options: MONEY_PERIODS }),
              ],
            },
          ],
        },
        {
          id: 'other', title: 'Other questions',
          fields: [
            f('felony', 'Have you or any adult on this application ever been convicted of a felony?', 'yesno', { req: true, help: 'If you have a sealed record under M.G.L. c. 276 §100A or c. 239, you may answer "No".' }),
            f('evicted', 'Have you ever been evicted or served with a Notice to Quit?', 'yesno', { req: true }),
            f('hasPet', 'Do you have a pet?', 'yesno', { req: true }),
            f('petDetails', 'Tell us about your pet(s)', 'text', { showIf: { k: 'hasPet', eq: 'Yes' }, placeholder: 'Type, breed, weight' }),
          ],
        },
      ],
      documents: [
        DOC_ID,
        { id: 'pay_stubs', label: 'Last three pay stubs', help: 'Or copies of your last three pay checks.', req: true },
        { id: 'tax_return', label: 'Most recent tax return (Form 1040)' },
        { id: 'other_income', label: 'Proof of other income', help: 'Award letters, voucher paperwork, etc. Note: bank statements are not accepted as proof of income.' },
        DOC_GUARANTOR,
        { id: 'reference_letter', label: 'Personal reference letter', help: 'Optional.' },
      ],
      certification: 'I/We hereby certify that the information furnished on this application is true and complete, to the best of my/our knowledge and belief. Inquiries may be made to verify the statements herein. All information is regarded as confidential in nature, and a consumer credit report and a Criminal Offender Record Information (CORI) report may also be requested. I/We understand that false statements or information are punishable under State or Federal law. Signed under the pains and penalties of perjury.',
      otherAdultSignatures: true,
      dealSheet: [
        heading('Beantown office use'),
        half('dateReceived', 'Date received', 'date'),
        half('timeReceived', 'Time received', 'text'),
      ],
      income(a) {
        let total = 0;
        (a.employment || []).forEach((j) => { total += num(j.monthlySalary); });
        (a.otherIncome || []).forEach((o) => { total += monthly(o.amount, o.per); });
        return total;
      },
      applicantName: (a) => a.name,
      applicantEmail: (a) => a.email,
      applicantPhone: (a) => a.phone,
    },

    /* ------------------------------------------------------------------ */
    hamilton: {
      id: 'hamilton',
      name: 'The Hamilton Company',
      short: 'Hamilton',
      title: 'The Hamilton Company Lease Application',
      blurb: 'Use this for apartments managed by The Hamilton Company. Each adult files their own application — share your link with roommates.',
      contact: '39 Brighton Avenue, Allston, MA 02134 · P 617-783-0039 · F 617-783-0568',
      minutes: 12,
      incomeMultiple: 2.5,
      separateAdults: true,
      steps: [
        {
          id: 'general', title: 'About you',
          intro: 'Hamilton will not process an incomplete application, so answer every question (use "N/A" where it doesn\'t apply).',
          fields: [
            f('name', 'Full legal name', 'text', { req: true, autocomplete: 'name' }),
            half('phone', 'Phone', 'tel', { req: true }),
            half('email', 'Email', 'email', { req: true }),
            half('dob', 'Date of birth', 'date', { req: true }),
            half('ssn', 'Social Security number', 'ssn', { help: 'Or provide an ITIN below.' }),
            half('itin', 'ITIN (if no SSN)', 'text', { sensitive: true }),
            half('hearAbout', 'How did you hear about us?', 'text'),
          ],
        },
        {
          id: 'residence', title: 'Where you live',
          fields: [
            heading('Present address'),
            ...address('cur', '', true),
            half('leaseInName', 'If renting, is the lease in your name?', 'select', { options: ['Yes', 'No', 'N/A – not renting'] }),
            half('curRent', 'Monthly rent', 'money'),
            half('curFrom', 'Lived here from', 'date', { req: true }),
            half('curTo', 'To', 'text', { placeholder: 'Present' }),
            half('curLandlord', 'Landlord\'s name', 'text', { req: true }),
            half('curLandlordPhone', 'Landlord\'s phone', 'tel', { req: true }),
            heading('Previous address'),
            ...address('prev', '', false),
            half('prevFrom', 'From', 'date'),
            half('prevTo', 'To', 'date'),
            half('prevLandlord', 'Previous landlord', 'text'),
            half('prevLandlordPhone', 'Landlord\'s phone', 'tel'),
            half('prevRent', 'Monthly rent', 'money'),
          ],
        },
        {
          id: 'income', title: 'Work & school',
          intro: 'You\'ll need monthly income of about 2.5× the rent, or a guarantor.',
          fields: [
            f('applicantType', 'Which best describes you?', 'radio', { req: true, options: ['Employed', 'Self-employed', 'Student', 'Retired / independent means', 'Exchange visitor (J-1)'] }),
            heading('Employment'),
            half('occupation', 'Occupation', 'text'),
            half('company', 'Company', 'text'),
            half('employerContact', 'Contact name & phone', 'text'),
            half('hireDate', 'Hire date', 'date'),
            half('monthlySalary', 'Monthly gross salary', 'money'),
            half('otherIncome', 'Other monthly income', 'money'),
            half('otherIncomeContact', 'Other income – source / contact', 'text'),
            heading('School information', 'Students only.'),
            half('school', 'College / university', 'text', { showIf: { k: 'applicantType', eq: 'Student' } }),
            half('schoolId', 'School ID #', 'text', { showIf: { k: 'applicantType', eq: 'Student' } }),
            f('schoolAddress', 'School address', 'text', { showIf: { k: 'applicantType', eq: 'Student' } }),
            half('program', 'Program', 'text', { showIf: { k: 'applicantType', eq: 'Student' } }),
            half('gradYear', 'Year of graduation', 'number', { showIf: { k: 'applicantType', eq: 'Student' } }),
            half('enrollment', 'Enrolled', 'select', { options: ['Full time', 'Part time'], showIf: { k: 'applicantType', eq: 'Student' } }),
            half('registrarPhone', 'Registrar\'s office phone', 'tel', { showIf: { k: 'applicantType', eq: 'Student' } }),
          ],
        },
        {
          id: 'apartment', title: 'Apartment & household',
          fields: [
            f('aptAddress', 'Apartment address & unit #', 'text', { req: true, deal: 'addressUnit' }),
            third('bedrooms', '# of bedrooms', 'text', { deal: 'bedrooms' }),
            third('occupants', 'Total # of occupants', 'number', { req: true }),
            third('pets', 'Total # of pets', 'number', { req: true }),
            third('occFrom', 'Move-in date', 'date', { deal: 'moveIn' }),
            third('occTo', 'Lease end date', 'date', { deal: 'leaseEnd' }),
            third('leaseMonths', 'Lease term (months)', 'number', { deal: 'leaseTerm' }),
            f('coTenants', 'Names of all co-tenants', 'textarea', { help: 'Each adult must file a separate application.' }),
            f('children', 'Names of all children under 18 who will live there', 'textarea'),
            f('childrenUnder7', 'Are any of the children under 7 years old?', 'yesno', { req: true, help: 'Asked for Massachusetts lead-paint law compliance.' }),
            heading('Emergency contact'),
            half('emergencyName', 'Contact name', 'text', { req: true }),
            half('emergencyPhone', 'Phone', 'tel', { req: true }),
            f('emergencyAddress', 'Complete address', 'text'),
          ],
        },
      ],
      documents: [
        DOC_ID,
        { id: 'pay_stubs', label: 'Two consecutive recent pay stubs', help: 'Dated within the last six weeks. Self-employed: current tax return. Retired: proof of liquid assets of $100,000+. Exchange visitors: J-1 visa.', req: true },
        { id: 'student_verification', label: 'Student verification', help: 'Course schedule or enrollment letter with your name and school, or a valid I-20 for international students.' },
        { ...DOC_GUARANTOR, help: 'Only if you\'re using a guarantor (Hamilton accepts guarantors for recent graduates within 6 months of graduation). ' + GUARANTOR_STEPS },
        { id: 'pet_docs', label: 'Pet documents', help: 'Vaccination / license records, if you have pets.' },
      ],
      authorization: 'I hereby authorize all third parties indicated on my application to furnish the information requested to The Hamilton Company and its rental agent. I release all third parties, their officers, agents, and employees from any and all liability associated with such disclosure of the requested information.',
      certification: 'This is an application form. I understand that all information will be verified, and credit bureau reports completed, of which the contents will be shared with the Landlord. Until the Landlord has approved the application, no tenancy has been created and I have no rights to this apartment. The rental agent has no power to make any representations as to whether this application has been accepted or denied by the Landlord. If denied, my sole remedy shall be the return of any deposit made hereunder. I warrant that all statements in this application are true and recognize that the Landlord will execute a lease in reliance upon their truthfulness. I agree to execute a Standard Apartment Lease on the terms herein. I become a lease signer only upon execution of the lease. In the event of termination after the lease has been executed, the one-month deposit held shall be forfeited. Balance must be paid by certified check or money order if received less than thirty (30) days prior to move-in.',
      dealSheet: [
        heading('Hamilton checklist & office use'),
        third('freeRent', 'Free rent offered?', 'yesno'),
        third('freeRentAmount', 'Free rent amount', 'money'),
        third('freeRentMonths', '# of months', 'number'),
        third('transfer', 'Transfer?', 'yesno'),
        third('finalRent', 'Final rent', 'money'),
        third('commission', 'Commission', 'money'),
        f('pcReview', 'PC review / decision', 'text'),
        f('managerReview', 'Manager review / decision', 'text'),
        heading('Present landlord reference', 'Completed by the agent after calling the applicant\'s current landlord.'),
        half('refTenantAddress', 'Tenant\'s address', 'text'),
        half('refDates', 'Dates of occupancy', 'text'),
        third('refRent', 'Amount of rent', 'money'),
        third('refOnTime', 'Paid on time?', 'yesno'),
        third('refReRent', 'Would re-rent?', 'yesno'),
        f('refProblems', 'Any problems?', 'text'),
        f('refBy', 'Reference given by (name & position)', 'text'),
      ],
      income: (a) => num(a.monthlySalary) + num(a.otherIncome),
      applicantName: (a) => a.name,
      applicantEmail: (a) => a.email,
      applicantPhone: (a) => a.phone,
    },

    /* ------------------------------------------------------------------ */
    standard: {
      id: 'standard',
      name: 'Dibiasio Realty',
      short: 'Standard',
      title: 'Dibiasio Realty Rental Application',
      blurb: 'Our standard application for all other landlords and owners. Each adult files their own application.',
      contact: '',
      minutes: 10,
      incomeMultiple: 3,
      separateAdults: true,
      steps: [
        {
          id: 'applicant', title: 'About you',
          fields: [
            f('name', 'Full legal name', 'text', { req: true, autocomplete: 'name' }),
            half('phone', 'Phone', 'tel', { req: true }),
            half('email', 'Email', 'email', { req: true }),
            half('ssn', 'Social Security number', 'ssn'),
            half('over18', 'Are you 18 or older?', 'yesno', { req: true }),
            heading('Present address'),
            ...address('cur', '', true),
            half('curFrom', 'Lived here from', 'date', { req: true }),
            half('curTo', 'To', 'text', { placeholder: 'Present' }),
            heading('Vehicle', 'Leave blank if you don\'t have a car.'),
            half('carMakeYear', 'Make / year', 'text'),
            half('carPlate', 'Registration state & plate #', 'text'),
          ],
        },
        {
          id: 'landlords', title: 'Rental history',
          fields: [
            heading('Present landlord'),
            half('presLandlord', 'Name', 'text', { req: true }),
            half('presLandlordPhone', 'Phone', 'tel', { req: true }),
            f('presLandlordAddress', 'Complete address', 'text'),
            heading('Former landlord'),
            half('formLandlord', 'Name', 'text'),
            half('formLandlordPhone', 'Phone', 'tel'),
            half('formOccupancy', 'Dates you lived there', 'text', { placeholder: 'e.g. 2021 – 2023' }),
            half('formLandlordAddress', 'Complete address', 'text'),
          ],
        },
        {
          id: 'employment', title: 'Employment',
          fields: [
            heading('Current employer'),
            half('employer', 'Employer', 'text', { req: true }),
            half('employerPhone', 'Phone', 'tel'),
            f('employerAddress', 'Complete address', 'text'),
            half('occupation', 'Occupation / source of income', 'text', { req: true }),
            half('businessType', 'Type of business', 'text'),
            third('salary', 'Salary', 'money', { req: true }),
            third('salaryPer', 'Per', 'select', { options: MONEY_PERIODS.slice().reverse(), req: true }),
            third('employmentLength', 'Length of employment', 'text'),
            heading('Former employer'),
            half('formEmployer', 'Employer', 'text'),
            half('formEmploymentLength', 'Length of employment', 'text'),
            half('formEmployerAddress', 'Complete address', 'text'),
            half('formEmployerPhone', 'Phone', 'tel'),
          ],
        },
        {
          id: 'references', title: 'References & bank',
          fields: [
            heading('Personal reference'),
            half('refName', 'Name', 'text', { req: true }),
            half('refPhone', 'Phone', 'tel', { req: true }),
            f('refAddress', 'Complete address', 'text'),
            heading('In case of emergency, notify'),
            half('emergencyName', 'Name', 'text', { req: true }),
            half('emergencyPhone', 'Phone', 'tel', { req: true }),
            f('emergencyAddress', 'Complete address', 'text'),
            heading('Credit reference'),
            half('creditRef', 'Name', 'text'),
            half('creditRefPhone', 'Phone', 'tel'),
            f('creditRefAddress', 'Complete address', 'text'),
            heading('Bank accounts', 'Only the last 4 digits of each account number are needed.'),
            third('checkingBank', 'Checking – bank', 'text'),
            third('checkingBranch', 'Branch address', 'text'),
            third('checkingLast4', 'Account # (last 4)', 'text', { maxlength: 4, inputmode: 'numeric', sensitive: true }),
            third('savingsBank', 'Savings – bank', 'text'),
            third('savingsBranch', 'Branch address', 'text'),
            third('savingsLast4', 'Account # (last 4)', 'text', { maxlength: 4, inputmode: 'numeric', sensitive: true }),
          ],
        },
        {
          id: 'apartment', title: 'Apartment',
          fields: [
            f('aptAddress', 'Apartment address', 'text', { req: true, deal: 'address' }),
            half('aptUnit', 'Apartment # / type', 'text', { deal: 'unitType' }),
            half('aptCity', 'City', 'text', { deal: 'city' }),
            third('occupancyDate', 'Occupancy date', 'date', { deal: 'moveIn' }),
            third('rentBegins', 'Rent begins', 'date', { deal: 'rentBegins' }),
            third('leaseMonths', 'Term of lease (months)', 'number', { deal: 'leaseTerm' }),
            half('leaseFrom', 'Lease from', 'date', { deal: 'leaseStart' }),
            half('leaseTo', 'Lease to', 'date', { deal: 'leaseEnd' }),
            heading('Household'),
            third('occupants', 'Total occupants', 'number', { req: true }),
            third('adults', 'Adults', 'number', { req: true }),
            third('pets', 'Pets', 'number', { req: true }),
            f('coTenants', 'Names of all co-tenants', 'textarea', { help: 'Each adult must file a separate application.' }),
            f('minors', 'Names & ages of minor children', 'textarea'),
            f('felony', 'Have you been convicted of a felony?', 'yesno', { req: true, help: 'If you have a sealed record, you may answer "No".' }),
            f('felonyDetail', 'Please describe the conviction(s)', 'textarea', { showIf: { k: 'felony', eq: 'Yes' } }),
          ],
        },
      ],
      documents: [
        DOC_ID,
        { id: 'pay_stubs', label: 'Proof of income', help: 'Recent pay stubs, offer letter, or tax return.', req: true },
        DOC_GUARANTOR,
        { id: 'other', label: 'Other documents', help: 'Anything else your agent asked for.' },
      ],
      certification: 'Pursuant to Massachusetts law, Management shall not make any inquiry concerning race, religious creed, color, national origin, sex, sexual orientation, gender identity, age (except if a minor), ancestry, marital status, veteran or military status, disability, genetic information, or receipt of public assistance or housing subsidy. I authorize the Management and/or Renting Agency to obtain or cause to be prepared a consumer credit report relating to me. Neither the Owner nor the Management is responsible for the loss of personal belongings caused by fire, theft, smoke, water or otherwise, unless caused by their negligence. I warrant that all statements herein are true and agree to execute upon presentation a lease or Tenancy at Will agreement in the usual form, which may be terminated by the Lessor if any statement herein is not true. Any deposit is to be applied as shown on the deal terms, or applied to actual damages sustained by the Owner, except it is to be refunded if this application is not accepted by the Owner. This application and deposit are taken subject to previous applications. The Renting Agent is an independent contractor and has no authority to make any representation concerning the premises; the Renting Agent is only authorized to show the apartment and assist in screening applicants.',
      dealSheet: [
        heading('Standard application terms'),
        third('otherMonthly', 'Other monthly charges (parking, etc.)', 'money'),
        third('depositOnAccount', 'Deposit on account', 'money'),
        third('balanceOnAcceptance', 'Balance due upon acceptance', 'money'),
      ],
      income: (a) => monthly(a.salary, a.salaryPer),
      applicantName: (a) => a.name,
      applicantEmail: (a) => a.email,
      applicantPhone: (a) => a.phone,
    },

    /* ------------------------------------------------------------------ */
    // The landlord's Guarantor Form, filled out online by the guarantor.
    guarantor: {
      id: 'guarantor',
      name: 'Guarantor',
      short: 'Guarantor',
      title: 'Guarantor Application',
      blurb: 'For a parent, relative or other person who agrees to guarantee a tenant\'s lease. The tenant applies separately.',
      contact: '',
      minutes: 6,
      incomeMultiple: 4,
      isGuarantor: true,
      steps: [
        {
          id: 'guarantor', title: 'About you',
          intro: 'You are guaranteeing someone else\'s lease. Start with your own details.',
          fields: [
            f('name', 'Full legal name', 'text', { req: true, autocomplete: 'name' }),
            half('phone', 'Phone', 'tel', { req: true }),
            half('email', 'Email', 'email', { req: true }),
            half('dob', 'Date of birth', 'date', { req: true }),
            half('ssn', 'Social Security number', 'ssn', { req: true, help: 'Needed for the credit check.' }),
            heading('Your address'),
            ...address('cur', '', true),
          ],
        },
        {
          id: 'tenant', title: 'The lease you\'re guaranteeing',
          intro: 'Tell us who you are guaranteeing and for which apartment.',
          fields: [
            f('tenantName', 'Tenant(s) you are guaranteeing', 'text', { req: true, placeholder: 'Full name of each tenant', help: 'If you guarantee more than one tenant, list each name.' }),
            half('relationship', 'Your relationship to the tenant', 'text', { req: true, placeholder: 'e.g. Parent, Aunt, Friend' }),
            half('aptAddress', 'Apartment address & unit #', 'text', { req: true, deal: 'addressUnit' }),
          ],
        },
        {
          id: 'income', title: 'Employment & income',
          intro: 'Landlords usually look for a guarantor who earns about 4 times the monthly rent.',
          fields: [
            half('employer', 'Employer', 'text', { req: true, placeholder: 'Or "Self-employed" / "Retired"' }),
            half('position', 'Position', 'text'),
            f('employerAddress', 'Employer\'s address', 'text'),
            half('employerPhone', 'Employer\'s phone', 'tel'),
            half('howLong', 'How long have you worked there?', 'text', { placeholder: 'e.g. 6 years' }),
            half('salary', 'Salary (before taxes)', 'money', { req: true }),
            half('salaryPer', 'Per', 'select', { options: MONEY_PERIODS.slice().reverse(), req: true }),
            half('otherIncome', 'Other monthly income', 'money'),
            half('otherIncomeSource', 'Source of other income', 'text', { placeholder: 'e.g. Rental property, pension' }),
          ],
        },
      ],
      documents: [
        { ...DOC_ID, help: 'Driver\'s license preferred, or passport / state ID. A clear phone photo is fine.' },
        { id: 'pay_stubs', label: 'Proof of income', help: 'Two recent pay stubs, or your most recent tax return or benefit letter.', req: true },
        { id: 'other', label: 'Other documents', help: 'Anything else your agent asked for.' },
      ],
      certification: 'In consideration of the lease for the premises listed in this application, I agree to be responsible for any financial obligation for rent, related services or damage payable under the lease or any extension or renewal of it, incurred by the tenant(s) named in this application, due to the lessor and its successors. I certify that the information I have provided is true and complete.',
      dealSheet: [],
      income: (a) => monthly(a.salary, a.salaryPer) + num(a.otherIncome),
      applicantName: (a) => a.name,
      applicantEmail: (a) => a.email,
      applicantPhone: (a) => a.phone,
    },
  };

  // Deal sheet fields every application shares; form-specific fields are appended.
  const DEAL_SHEET = [
    heading('Property'),
    f('address', 'Property address', 'text'),
    third('unit', 'Unit #', 'text'),
    third('city', 'City', 'text'),
    third('bedrooms', 'Bedrooms', 'select', { options: ['Studio', 'One bedroom', 'Two bedroom', 'Three bedroom', 'Four bedroom', 'Five+ bedroom'] }),
    half('landlord', 'Landlord / management company', 'text'),
    half('landlordContact', 'Landlord contact (email / phone)', 'text'),
    heading('Lease terms'),
    third('rent', 'Monthly rent', 'money'),
    third('moveIn', 'Move-in date', 'date'),
    third('rentBegins', 'Rent begins', 'date'),
    third('leaseTerm', 'Lease term (months)', 'number'),
    third('leaseStart', 'Lease start', 'date'),
    third('leaseEnd', 'Lease end', 'date'),
    third('utilities', 'Utilities included', 'text'),
    third('parking', 'Parking', 'text'),
    third('petsAllowed', 'Pets', 'text'),
    heading('Move-in costs'),
    third('firstMonth', 'First month\'s rent', 'money'),
    third('lastMonth', 'Last month\'s rent', 'money'),
    third('securityDeposit', 'Security deposit', 'money'),
    third('keyLock', 'Key / lock', 'money'),
    third('brokerFee', 'Broker fee', 'money'),
    third('feePaidBy', 'Broker fee paid by', 'select', { options: ['Landlord', 'Tenant', 'Split'] }),
    third('depositCollected', 'Deposit collected', 'money'),
    third('depositMethod', 'Deposit paid by', 'select', { options: ['Certified check', 'Money order', 'Personal check', 'Zelle / ACH', 'Other'] }),
    third('ownerDeadline', 'Owner must act by', 'date'),
    heading('Agents & commission'),
    half('listingAgent', 'Listing agent / office', 'text'),
    half('coBroke', 'Co-broke agent / office', 'text'),
    third('commissionTotal', 'Total commission', 'money'),
    third('agentSplit', 'Agent split %', 'number'),
    third('referral', 'Referral / lead source', 'text'),
    f('notes', 'Deal notes', 'textarea'),
  ];

  const STATUSES = ['New', 'In review', 'Docs needed', 'Sent to landlord', 'Approved', 'Denied', 'Lease signed', 'Withdrawn'];

  function num(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function monthly(amount, per) {
    const n = num(amount);
    switch (per) {
      case 'per week': return n * 52 / 12;
      case 'every 2 weeks': return n * 26 / 12;
      case 'per year': return n / 12;
      default: return n;
    }
  }

  // Map a deal's property to the prefill keys forms reference via `deal:`.
  function dealPrefill(p) {
    p = p || {};
    const addressUnit = [p.address, p.unit ? 'Unit ' + p.unit : '', p.city].filter(Boolean).join(', ');
    return {
      address: [p.address, p.city].filter(Boolean).join(', '),
      addressUnit,
      unitType: [p.unit, p.bedrooms].filter(Boolean).join(' / '),
      city: p.city || '',
      bedrooms: p.bedrooms || '',
      moveIn: p.moveIn || '',
      rentBegins: p.rentBegins || '',
      leaseTerm: p.leaseTerm || '',
      leaseStart: p.leaseStart || '',
      leaseEnd: p.leaseEnd || '',
    };
  }

  const api = { FORMS, DEAL_SHEET, STATUSES, STATES, GUARANTOR_URL, num, monthly, dealPrefill };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DR = api;
})(this);
