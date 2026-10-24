// Simulated broker: fills market orders at the current price with a fee and
// a little slippage so results are not unrealistically good.

const fs = require('fs');
const path = require('path');

const FEE_RATE = 0.001; // 0.1%, typical spot taker fee
const SLIPPAGE = 0.0005; // 0.05%

class PaperBroker {
  constructor(config, { persist = true } = {}) {
    this.mode = 'paper';
    this.quote = config.quote;
    this.file = persist ? path.join(config.dataDir, 'paper-account.json') : null;
    this.state = this.load() || { cash: config.paperStartingBalance, holdings: {} };
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  async init() {}

  async getBalances() {
    return { cash: this.state.cash, holdings: { ...this.state.holdings } };
  }

  async buy(symbol, quoteAmount, price) {
    if (quoteAmount > this.state.cash + 1e-9) throw new Error(`Insufficient ${this.quote}: have ${this.state.cash.toFixed(2)}`);
    const base = symbol.split('/')[0];
    const fill = price * (1 + SLIPPAGE);
    const fee = quoteAmount * FEE_RATE;
    const amount = (quoteAmount - fee) / fill;
    this.state.cash -= quoteAmount;
    this.state.holdings[base] = (this.state.holdings[base] || 0) + amount;
    this.save();
    return { id: `paper-${Date.now()}`, symbol, side: 'buy', amount, price: fill, cost: quoteAmount, fee };
  }

  async sell(symbol, amount, price) {
    const base = symbol.split('/')[0];
    const held = this.state.holdings[base] || 0;
    if (amount > held + 1e-12) throw new Error(`Insufficient ${base}: have ${held}`);
    const fill = price * (1 - SLIPPAGE);
    const gross = amount * fill;
    const fee = gross * FEE_RATE;
    this.state.cash += gross - fee;
    this.state.holdings[base] = held - amount;
    if (this.state.holdings[base] < 1e-12) delete this.state.holdings[base];
    this.save();
    return { id: `paper-${Date.now()}`, symbol, side: 'sell', amount, price: fill, cost: gross, fee };
  }

  async reset(startingBalance) {
    this.state = { cash: startingBalance, holdings: {} };
    this.save();
  }
}

module.exports = { PaperBroker, FEE_RATE, SLIPPAGE };
