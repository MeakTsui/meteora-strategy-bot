# 🪐 Meteora DLMM Strategy Bot

Automated market-making bot for Meteora DLMM (Dynamic Liquidity Market Maker) protocol on Solana. This bot implements three complementary strategies to maximize returns while managing risk.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Strategy Details](#strategy-details)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [Risk Warnings](#risk-warnings)
- [License](#license)

## 🎯 Overview

This bot manages a $5,000 USDC portfolio across three automated strategies:

1. **Bid-Ask High-Frequency Strategy (70% capital)** - Main profit driver
2. **Trend Following Strategy (20% capital)** - Captures strong market movements
3. **Insurance Strategy (10% capital)** - Provides safety net during crashes

The bot operates on SOL price range of $100-$250, divided into $5 intervals.

## ✨ Features

- 🔄 **Multi-Strategy Execution**: Three complementary strategies working together
- 📊 **Real-time Price Monitoring**: Multiple data source fallbacks (Jupiter, Helius, Birdeye)
- 🛡️ **Circuit Breaker**: Automatic trading pause after consecutive failures
- 💰 **Capital Allocation**: Intelligent distribution across strategies
- 📈 **Backtest Simulator**: Test strategies with historical data
- 🧪 **Dry Run Mode**: Test without risking real capital
- 📝 **Comprehensive Logging**: Detailed execution logs and statistics
- ⚡ **Automatic Rebalancing**: Positions automatically adjusted based on price movements

## 🎲 Strategy Details

### 1. Bid-Ask High-Frequency Strategy (Main - 70%)

**Objective**: Generate consistent returns through frequent position recycling

- Deploys positions in $5 price ranges using SOL_ONLY mode
- When price breaks above range upper bound (+ 0.3% threshold):
  - Withdraws position (captures profit)
  - Redeploys in same range
  - Compounds gains
- Targets 20-35% APR through frequent rebalancing

**Example**:
- Position in $140-$145 range with 1 SOL
- Price moves to $145.50 → Withdraw and redeploy
- Captured ~3.9% gain, ready for next cycle

### 2. Trend Following Strategy (20%)

**Objective**: Capitalize on strong directional moves

- Activates after 3 consecutive range breakouts
- **Uptrend**: Deploys SOL_ONLY in upper ranges
- **Downtrend**: Deploys USDC_ONLY in lower ranges
- Exits on trend reversal

**Example**:
- Price breaks through $140→$145→$150 consecutively
- Bot deploys SOL_ONLY position in $155-$160 range
- Rides momentum, exits if price reverses

### 3. Insurance Strategy (10%)

**Objective**: Profit from extreme market crashes

- Pre-defined "catch-dip" ranges: $80-$100, $60-$80, $40-$60
- Only activates when price crashes into these zones
- Exits after 10%+ rebound
- Provides exceptional returns during market panic

**Example**:
- Price crashes from $150 to $75
- Bot deploys in $60-$80 range
- Price rebounds to $82.50 → Exit with 10% profit

## 🚀 Installation

### Prerequisites

- Node.js 18+ and npm
- Solana wallet with private key
- (Optional) API keys for price data sources

### Steps

```bash
# Clone repository
cd dlmm-strategy-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

## ⚙️ Configuration

### Required Environment Variables

```bash
# Solana Configuration
RPC_URL=https://api.mainnet-beta.solana.com
WALLET_PRIVATE_KEY=your_base58_private_key_here

# Capital & Strategy Allocation
TOTAL_CAPITAL_USDC=5000
MAIN_STRATEGY_ALLOCATION=0.70      # Bid-Ask
TREND_STRATEGY_ALLOCATION=0.20     # Trend Following
INSURANCE_STRATEGY_ALLOCATION=0.10 # Insurance

# Price Range
MIN_PRICE=100
MAX_PRICE=250
GRID_SIZE=5

# Strategy Parameters
REDEPLOY_THRESHOLD=0.003           # 0.3% above range
TREND_BREAKOUT_COUNT=3             # Consecutive breakouts
REBOUND_THRESHOLD=0.10             # 10% rebound for insurance exit

# Bot Configuration
CHECK_INTERVAL_MS=60000            # Check every 60 seconds
MAX_CONSECUTIVE_FAILURES=5         # Circuit breaker
ENABLE_DRY_RUN=true                # Start in dry run mode
```

### Optional API Keys

```bash
# Price Data Sources (improve reliability)
HELIUS_API_KEY=your_helius_key
BIRDEYE_API_KEY=your_birdeye_key
```

## 📖 Usage

### 1. Run Simulation (Recommended First)

Test capital allocation and position parameters:

```bash
npm run simulate
```

Output:
- Capital allocation across strategies
- Position size calculations
- Estimated APR for sample positions

### 2. Run Backtest

Test strategies against historical data:

```bash
npm run backtest
```

Output:
- Total trades and success rate
- Profit/loss analysis
- Max drawdown and annualized return
- Top performing ranges

### 3. Start Bot (Dry Run)

Test bot execution without real transactions:

```bash
# Ensure ENABLE_DRY_RUN=true in .env
npm run start
```

### 4. Start Bot (Live Trading)

⚠️ **WARNING**: Only after thorough testing!

```bash
# Set ENABLE_DRY_RUN=false in .env
npm run start
```

### Development Mode

```bash
npm run dev
```

## 🏗️ Architecture

```
dlmm-strategy-bot/
├── src/
│   ├── config/
│   │   └── config.ts          # Configuration management
│   ├── core/
│   │   └── bot.ts             # Main bot orchestration
│   ├── services/
│   │   ├── priceService.ts    # Multi-source price feeds
│   │   ├── rangeManager.ts    # Range division & tracking
│   │   └── dlmmService.ts     # Meteora DLMM interface
│   ├── strategies/
│   │   ├── bidAskStrategy.ts  # Main profit strategy
│   │   ├── trendStrategy.ts   # Trend following
│   │   └── insuranceStrategy.ts # Safety net
│   ├── types/
│   │   └── index.ts           # TypeScript definitions
│   ├── utils/
│   │   ├── logger.ts          # Winston logging
│   │   └── helpers.ts         # Utility functions
│   ├── index.ts               # Entry point
│   ├── backtest.ts            # Backtesting engine
│   └── simulate.ts            # Position simulator
├── logs/                      # Execution logs
├── .env.example               # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

### Key Components

**Price Service**: 
- Fetches SOL price from multiple sources
- Automatic fallback on failure
- Real-time price subscriptions

**Range Manager**:
- Divides $100-$250 into $5 ranges
- Tracks current price range
- Detects breakouts

**DLMM Service**:
- Interfaces with Meteora protocol
- Creates/withdraws positions
- Handles transaction signing

**Strategies**:
- Independent strategy execution
- Position lifecycle management
- Profit/loss tracking

**Bot Coordinator**:
- Executes strategies on schedule
- Circuit breaker protection
- Comprehensive logging

## ⚠️ Risk Warnings

### Financial Risks

1. **Impermanent Loss**: LP positions subject to IL during price movements
2. **Market Risk**: Crypto prices are highly volatile
3. **Smart Contract Risk**: Meteora protocol vulnerabilities
4. **Slippage**: Large positions may experience price impact
5. **Gas Fees**: Transaction costs reduce net profits

### Technical Risks

1. **RPC Failures**: Connection issues may miss opportunities
2. **Price Feed Delays**: Outdated prices lead to bad decisions
3. **Transaction Failures**: Failed txs waste fees
4. **MEV/Front-running**: Bots may front-run your transactions

### Operational Risks

1. **Configuration Errors**: Wrong parameters = losses
2. **Insufficient Capital**: Small positions earn minimal returns
3. **Private Key Security**: Compromised keys = total loss
4. **No Stop Loss**: Bot continues trading in adverse conditions

### Recommendations

✅ **DO**:
- Start with dry run mode
- Test with small capital first
- Monitor logs regularly
- Keep private keys secure
- Use hardware wallet for large amounts

❌ **DON'T**:
- Use funds you can't afford to lose
- Leave bot unattended for days
- Ignore error messages
- Share your private key
- Deploy without testing

## 📊 Expected Performance

Based on backtesting (not guaranteed):

- **Bid-Ask Strategy**: 20-35% APR
- **Trend Strategy**: 15-40% APR (variable)
- **Insurance Strategy**: 0-100% APR (event-driven)
- **Overall Target**: 25-35% APR
- **Max Drawdown**: 10-15%

Actual results depend on market conditions, execution quality, and luck.

## 🔧 Troubleshooting

### Common Issues

**1. "Failed to get price"**
- Check RPC_URL connectivity
- Verify API keys are valid
- Check internet connection

**2. "Circuit breaker tripped"**
- Review error logs
- Check wallet balance
- Verify position limits

**3. "Insufficient capital"**
- Increase TOTAL_CAPITAL_USDC
- Reduce number of active positions
- Adjust allocation percentages

**4. Transactions failing**
- Increase RPC timeout
- Check wallet SOL balance (for fees)
- Verify pool liquidity

### Logs

Check daily logs in `logs/` directory:
```bash
tail -f logs/$(date +%Y-%m-%d).log
```

## 🤝 Contributing

This is a personal project. Feel free to fork and modify for your needs.

## 📄 License

MIT License - Use at your own risk

## ⚖️ Disclaimer

This software is provided "as is" without warranty. The authors are not responsible for any financial losses. Cryptocurrency trading carries substantial risk. Only invest what you can afford to lose.

**Not financial advice. Do your own research.**

---

Made with ☄️ for Meteora DLMM

**Happy trading! 🚀**
