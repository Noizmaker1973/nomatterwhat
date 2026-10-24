// Updates settings in .env without touching anything else in it.
//
//   npm run configure -- TIMEFRAME=1d STRATEGY_MODE=ma MA_PERIOD=50
//   npm run configure                 # show the current strategy settings
//
// Existing lines are changed in place (comments and API keys are kept), new
// settings are added at the end, and the previous file is saved as .env.bak.
// Creates .env from .env.example if it doesn't exist yet.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
const exampleFile = path.join(root, '.env.example');

// Every setting the platform reads, taken from .env.example.
function knownKeys() {
  const text = fs.readFileSync(exampleFile, 'utf8');
  return new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

function parseAssignments(args) {
  const updates = [];
  for (const arg of args) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(arg);
    if (!match) throw new Error(`"${arg}" is not KEY=VALUE`);
    updates.push([match[1].toUpperCase(), match[2].trim()]);
  }
  return updates;
}

// Returns the new file text and a list of human-readable changes.
function applyUpdates(text, updates) {
  const lines = text.split(/\r?\n/);
  const changes = [];
  for (const [key, value] of updates) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index === -1) {
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push(`${key}=${value}`, '');
      changes.push(`added   ${key}=${value}`);
      continue;
    }
    // Keep a trailing "# comment" on the line, if any.
    const comment = /(\s+#.*)$/.exec(lines[index].split('=').slice(1).join('='));
    const old = lines[index].split('=').slice(1).join('=').replace(/\s+#.*$/, '').trim();
    if (old === value) {
      changes.push(`same    ${key}=${value}`);
      continue;
    }
    lines[index] = `${key}=${value}${comment ? comment[1] : ''}`;
    changes.push(`changed ${key}: ${old || '(empty)'} -> ${value}`);
  }
  return { text: lines.join('\n'), changes };
}

function main() {
  if (!fs.existsSync(envFile)) {
    fs.copyFileSync(exampleFile, envFile);
    console.log('Created .env from .env.example');
  }
  const text = fs.readFileSync(envFile, 'utf8');
  const updates = parseAssignments(process.argv.slice(2));

  if (!updates.length) {
    const show = ['TIMEFRAME', 'STRATEGY_MODE', 'BUY_THRESHOLD', 'SELL_THRESHOLD', 'MA_PERIOD', 'STOP_ATR_MULT', 'TARGET_ATR_MULT', 'TRAIL_ATR_MULT', 'MAX_POSITION_PCT', 'TRADING_MODE', 'AUTO_TRADE'];
    console.log('Current settings in .env (missing = using the default):');
    for (const key of show) {
      const m = new RegExp(`^\\s*${key}\\s*=(.*)$`, 'm').exec(text);
      console.log(`  ${key.padEnd(17)} ${m ? m[1].replace(/\s+#.*$/, '').trim() || '(empty)' : '(missing)'}`);
    }
    return;
  }

  const known = knownKeys();
  const unknown = updates.filter(([key]) => !known.has(key)).map(([key]) => key);
  if (unknown.length) {
    throw new Error(`Unknown setting(s): ${unknown.join(', ')}. Check the spelling against .env.example. Nothing was changed.`);
  }

  const result = applyUpdates(text, updates);
  fs.writeFileSync(`${envFile}.bak`, text);
  fs.writeFileSync(envFile, result.text);
  result.changes.forEach((c) => console.log(c));
  console.log('\nSaved .env (previous version in .env.bak). Restart the platform to use the new settings.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { applyUpdates, parseAssignments };
