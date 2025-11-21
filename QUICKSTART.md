# 🚀 Quick Start Guide

Get your DLMM Strategy Bot running in 5 minutes!

## Prerequisites Checklist

- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] Solana wallet with private key
- [ ] At least 0.1 SOL for transaction fees
- [ ] Capital in USDC for trading

## Step-by-Step Setup

### 1. Navigate to Project

```bash
cd dlmm-strategy-bot
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including:
- @solana/web3.js
- @meteora-ag/dlmm
- Winston for logging
- And more...

### 3. Configure Environment

```bash
# Copy the template
cp .env.example .env

# Edit with your favorite editor
nano .env
# or
code .env
```

**Minimum Required Configuration:**

```bash
# REQUIRED: Solana RPC
RPC_URL=https://api.mainnet-beta.solana.com

# REQUIRED: Your wallet private key (base58 encoded)
# Get it from: solana-keygen display ~/.config/solana/id.json
WALLET_PRIVATE_KEY=your_base58_private_key_here

# REQUIRED: Capital to deploy
TOTAL_CAPITAL_USDC=1000

# REQUIRED: Start in dry run mode
ENABLE_DRY_RUN=true
```

**Important**: Keep `ENABLE_DRY_RUN=true` for testing!

### 4. Test Configuration

Run the simulator to verify your setup:

```bash
npm run simulate
```

Expected output:
```
💰 Simulating Capital Allocation...

Strategy Allocations:
  Bid-Ask Strategy: $700.00 (70%)
  Trend Strategy: $200.00 (20%)
  Insurance Strategy: $100.00 (10%)
  
...
✅ Allocation simulation complete
```

### 5. Run Backtest

Test strategies with simulated historical data:

```bash
npm run backtest
```

Expected output:
```
📊 BACKTEST RESULTS
====================================
Trading Statistics:
  Total Trades: 45
  Successful Trades: 42
  Success Rate: 93.33%
  
Profit & Loss:
  Total Profit: $156.78
  Net Profit: $152.34
  Return: 15.23%
```

### 6. Start Bot (Dry Run)

Run the bot without real transactions:

```bash
npm run start
```

You should see:
```
☄️  METEORA DLMM STRATEGY BOT ☄️
================================

✅ Configuration validated

🚀 Starting DLMM Strategy Bot...
⚠️  DRY RUN MODE ENABLED - No real transactions

====================================
Executing strategies at price: $145.23
====================================

📊 Executing Bid-Ask Strategy...
📈 Executing Trend Strategy...
🛡️  Executing Insurance Strategy...
```

The bot will run continuously, checking every 60 seconds.

Press `Ctrl+C` to stop.

## ✅ You're Running!

The bot is now operating in **dry run mode**. It will:
- Monitor SOL price every 10 seconds
- Simulate position creation
- Log all actions
- Report statistics every cycle

### Check Logs

```bash
# View today's log
tail -f logs/$(date +%Y-%m-%d).log

# View in real-time with colored output
npm run dev
```

## 📊 Next Steps

### 1. Monitor for 24 Hours

Let the bot run in dry run mode for at least 24 hours to:
- Verify price feeds are working
- Check strategy logic
- Review position decisions
- Analyze profit estimates

### 2. Review Logs

Check the logs for:
- ✅ Successful price fetches
- ✅ Position creation simulations
- ✅ Rebalance triggers
- ❌ Any errors or warnings

### 3. Tune Configuration

Based on your observations, adjust:

```bash
# .env file

# Make rebalancing more/less frequent
REDEPLOY_THRESHOLD=0.003  # 0.3% (default)
                          # Lower = more frequent
                          # Higher = less frequent

# Adjust trend sensitivity
TREND_BREAKOUT_COUNT=3    # Require 3 consecutive breakouts
                          # Lower = more trades
                          # Higher = fewer trades

# Change check frequency
CHECK_INTERVAL_MS=60000   # 60 seconds (default)
                          # Lower = more CPU usage
                          # Higher = might miss opportunities
```

### 4. (Optional) Go Live

⚠️ **Only after thorough testing!**

```bash
# Edit .env
ENABLE_DRY_RUN=false

# Restart bot
npm run start
```

**First Time Live Trading:**
- Start with minimum capital ($100-500)
- Monitor very closely for first 48 hours
- Be ready to stop the bot if issues arise
- Gradually increase capital if successful

## 🆘 Troubleshooting

### "Failed to get price"

**Solution**: Check RPC connection
```bash
# Test RPC manually
curl https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

### "Circuit breaker tripped"

**Solution**: Check error logs
```bash
grep ERROR logs/$(date +%Y-%m-%d).log
```

Common causes:
- RPC rate limits → Use paid RPC
- Insufficient SOL for fees → Add SOL to wallet
- Network issues → Check internet connection

### Lint Errors in IDE

**Normal!** Install dependencies first:
```bash
npm install
```

### Bot Not Creating Positions

In dry run mode, this is expected. Check for:
```
[DRY RUN] Position creation transaction prepared
```

This confirms the bot is working correctly.

## 📱 Quick Commands

```bash
# Install
npm install

# Simulate allocation
npm run simulate

# Run backtest
npm run backtest

# Start bot (dry run)
npm run start

# Start bot (development mode with auto-reload)
npm run dev

# View logs
tail -f logs/$(date +%Y-%m-%d).log

# Stop bot
Ctrl + C
```

## 🎯 Success Metrics

After 24 hours of dry run, you should see:

✅ **Price Service**
- No "Failed to get price" errors
- Price updates every ~10 seconds
- Values within expected range ($100-$250)

✅ **Strategies**
- Bid-Ask positions created in current range
- Trend strategy waiting for breakouts
- Insurance strategy monitoring crash zones

✅ **Logs**
- Clean execution logs
- Statistics reported each cycle
- No circuit breaker trips

## 📚 Learn More

- Full documentation: [README.md](README.md)
- Project summary: [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- Strategy details: [README.md#strategy-details](README.md#strategy-details)

## ⚡ Pro Tips

1. **Use a Dedicated RPC**: Public RPCs have rate limits
   - Consider: Helius, QuickNode, or Triton
   - Set in `RPC_URL` env variable

2. **Monitor Gas Fees**: Solana fees are low but add up
   - Keep 0.1-0.5 SOL in wallet
   - Bot will fail if insufficient fees

3. **Start Small**: Test with minimal capital first
   - $100-500 for initial testing
   - Scale up gradually

4. **Check Meteora**: Verify positions on Meteora UI
   - https://app.meteora.ag/dlmm
   - Connect your wallet to see positions

5. **Backup Wallet**: Never lose your private key
   - Store securely offline
   - Consider hardware wallet for large amounts

---

**Ready to trade?** 🚀

Remember: Start with dry run mode and monitor carefully!

Good luck! 💰
