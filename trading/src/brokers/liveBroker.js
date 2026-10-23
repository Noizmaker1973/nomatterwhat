// Real broker: places market orders on your exchange account through CCXT.

const { createExchange } = require('../marketData');

class LiveBroker {
  constructor(config) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Live trading needs EXCHANGE_API_KEY and EXCHANGE_API_SECRET in .env');
    }
    this.mode = 'live';
    this.quote = config.quote;
    this.symbols = config.symbols;
    this.exchange = createExchange(config, { withKeys: true });
  }

  async init() {
    await this.exchange.loadMarkets();
    const missing = this.symbols.filter((s) => !this.exchange.markets[s]);
    if (missing.length) {
      throw new Error(`${this.exchange.id} does not list: ${missing.join(', ')}. Change SYMBOLS, QUOTE_CURRENCY or EXCHANGE.`);
    }
  }

  async getBalances() {
    const balance = await this.exchange.fetchBalance();
    const holdings = {};
    for (const symbol of this.symbols) {
      const base = symbol.split('/')[0];
      // "free" excludes coins locked in open orders, which cannot be sold.
      const free = balance.free?.[base] || 0;
      if (free > 0) holdings[base] = free;
    }
    return { cash: balance.free?.[this.quote] || 0, holdings };
  }

  checkMinimums(symbol, amount, cost) {
    const limits = this.exchange.markets[symbol]?.limits || {};
    if (limits.amount?.min && amount < limits.amount.min) {
      throw new Error(`Order amount ${amount} below ${symbol} minimum ${limits.amount.min}`);
    }
    if (limits.cost?.min && cost < limits.cost.min) {
      throw new Error(`Order value ${cost.toFixed(2)} below ${symbol} minimum ${limits.cost.min}`);
    }
  }

  normalize(order, symbol, side, fallbackPrice) {
    const price = order.average || order.price || fallbackPrice;
    const amount = order.filled || order.amount;
    return {
      id: order.id,
      symbol,
      side,
      amount,
      price,
      cost: order.cost || amount * price,
      fee: order.fee?.cost || 0,
    };
  }

  async buy(symbol, quoteAmount, price) {
    const estAmount = quoteAmount / price;
    this.checkMinimums(symbol, estAmount, quoteAmount);
    let order;
    if (this.exchange.has.createMarketBuyOrderWithCost) {
      order = await this.exchange.createMarketBuyOrderWithCost(symbol, Number(this.exchange.costToPrecision(symbol, quoteAmount)));
    } else {
      order = await this.exchange.createMarketOrder(symbol, 'buy', Number(this.exchange.amountToPrecision(symbol, estAmount)));
    }
    return this.normalize(order, symbol, 'buy', price);
  }

  async sell(symbol, amount, price) {
    const precise = Number(this.exchange.amountToPrecision(symbol, amount));
    this.checkMinimums(symbol, precise, precise * price);
    const order = await this.exchange.createMarketOrder(symbol, 'sell', precise);
    return this.normalize(order, symbol, 'sell', price);
  }
}

module.exports = { LiveBroker };
