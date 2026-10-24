// Simulated broker: fills market orders at the current price with a fee and
// a little slippage so results are not unrealistically good.
//
// Shorts are simulated like a margin account: opening a short sets aside its
// value as collateral (unavailable for buying), profit/loss is
// amount x (entry - exit), and borrowing costs SHORT_COST_APR per year,
// charged when the short is covered.

const fs = require('fs');
const path = require('path');

const FEE_RATE = 0.001; // 0.1%, typical spot taker fee
const SLIPPAGE = 0.0005; // 0.05%

class PaperBroker {
  constructor(config, { persist = true } = {}) {
    this.mode = 'paper';
    this.supportsShort = true;
    this.quote = config.quote;
    this.shortCostApr = config.shortCostApr ?? 10;
    this.file = persist ? path.join(config.dataDir, 'paper-account.json') : null;
    this.state = this.load() || { cash: config.paperStartingBalance, holdings: {}, shorts: {} };
    this.state.shorts = this.state.shorts || {}; // accounts saved before shorting existed
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

  collateral() {
    return Object.values(this.state.shorts).reduce((sum, s) => sum + s.amount * s.entry, 0);
  }

  // cash = what is free to spend; short collateral is reported per short.
  async getBalances() {
    const shorts = Object.fromEntries(Object.entries(this.state.shorts).map(([k, v]) => [k, { ...v }]));
    return { cash: this.state.cash - this.collateral(), holdings: { ...this.state.holdings }, shorts };
  }

  async buy(symbol, quoteAmount, price) {
    const free = this.state.cash - this.collateral();
    if (quoteAmount > free + 1e-9) throw new Error(`Insufficient ${this.quote}: have ${free.toFixed(2)} free`);
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

  async openShort(symbol, quoteAmount, price) {
    const free = this.state.cash - this.collateral();
    if (quoteAmount > free + 1e-9) throw new Error(`Insufficient ${this.quote} for short collateral: have ${free.toFixed(2)} free`);
    const base = symbol.split('/')[0];
    const fill = price * (1 - SLIPPAGE);
    const fee = quoteAmount * FEE_RATE;
    const amount = quoteAmount / fill;
    const prev = this.state.shorts[base];
    const total = (prev?.amount || 0) + amount;
    this.state.cash -= fee;
    this.state.shorts[base] = {
      amount: total,
      entry: ((prev?.entry || 0) * (prev?.amount || 0) + fill * amount) / total,
      openedAt: prev?.openedAt || Date.now(),
    };
    this.save();
    return { id: `paper-${Date.now()}`, symbol, side: 'short', amount, price: fill, cost: quoteAmount, fee };
  }

  async coverShort(symbol, amount, price) {
    const base = symbol.split('/')[0];
    const short = this.state.shorts[base];
    if (!short || amount > short.amount + 1e-12) throw new Error(`No ${base} short of that size to cover`);
    const fill = price * (1 + SLIPPAGE);
    const fee = amount * fill * FEE_RATE;
    const days = (Date.now() - short.openedAt) / 86400e3;
    const carry = amount * short.entry * (this.shortCostApr / 100) * (days / 365);
    const grossPnl = amount * (short.entry - fill);
    this.state.cash += grossPnl - fee - carry;
    short.amount -= amount;
    if (short.amount < 1e-12) delete this.state.shorts[base];
    this.save();
    return { id: `paper-${Date.now()}`, symbol, side: 'cover', amount, price: fill, cost: amount * fill, fee: fee + carry, grossPnl, carry, entry: short.entry };
  }

  async reset(startingBalance) {
    this.state = { cash: startingBalance, holdings: {}, shorts: {} };
    this.save();
  }
}

module.exports = { PaperBroker, FEE_RATE, SLIPPAGE };
