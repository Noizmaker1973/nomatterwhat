// Loads Apps Script .gs files into a sandbox so pure functions can be tested in Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function load(...files) {
  const ctx = {};
  vm.createContext(ctx);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
};
