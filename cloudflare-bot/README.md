# Meteora DLMM Bid-Ask Rebalancer (Cloudflare Workers)

基于 Cloudflare Workers 的 Meteora DLMM Bid-Ask 重新平衡机器人。

## 功能特性

- **Bid-Ask 重新平衡**: 自动检测仓位状态，在价格穿越区间时重新部署流动性
- **手续费自动领取**: 达到阈值后自动领取累积的手续费
- **价值追踪**: 记录仓位价值快照、每日 PnL、操作历史
- **Dashboard API**: 提供完整的 REST API 用于监控和管理

## 快速开始

### 1. 安装依赖

```bash
cd cloudflare-bot
npm install
```

### 2. 配置环境

复制环境变量示例文件：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars` 填入实际值：

```
WALLET_PRIVATE_KEY=your_wallet_private_key_here
RPC_URL=https://your-rpc-endpoint.com
```

### 3. 创建 D1 数据库

```bash
# 创建数据库
npx wrangler d1 create meteora-bot

# 更新 wrangler.toml 中的 database_id

# 运行迁移
npx wrangler d1 execute meteora-bot --file=./migrations/0001_init.sql
```

### 4. 创建 KV 命名空间

```bash
npx wrangler kv:namespace create STATE

# 更新 wrangler.toml 中的 KV namespace id
```

### 5. 设置 Secrets

```bash
npx wrangler secret put WALLET_PRIVATE_KEY
npx wrangler secret put RPC_URL
```

### 6. 本地开发

```bash
npm run dev
```

### 7. 部署

```bash
npm run deploy
```

## 配置说明

### wrangler.toml 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `POOL_ADDRESS` | DLMM 池地址 | SOL-USDC 池 |
| `PRIORITY_FEE` | 交易优先费 (microLamports) | 1000 |
| `VERBOSE` | 是否启用详细日志 | false |
| `LOG_LEVEL` | 日志级别 (debug/info/warn/error) | info |
| `CLAIM_FEE_ENABLED` | 是否启用自动领取手续费 | true |
| `CLAIM_FEE_THRESHOLD_USD` | 领取手续费阈值 (USD) | 5 |
| `CLAIM_FEE_CHECK_HOUR` | 每日检查手续费的 UTC 小时 | 8 |
| `CLAIM_FEE_MIN_POSITION_USD` | 单仓位最小领取阈值 (USD) | 0.1 |

## API 接口

### Dashboard API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/summary` | GET | 获取汇总数据 |
| `/api/positions` | GET | 获取仓位数据 |
| `/api/pnl?days=30` | GET | 获取每日 PnL |
| `/api/value-history?hours=24` | GET | 获取价值历史 |
| `/api/operations?count=50` | GET | 获取操作历史 |
| `/api/claimed-fees?count=50` | GET | 获取已领取手续费历史 |
| `/api/fee-history?days=30` | GET | 获取手续费历史 |

### 手动触发

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/rebalance` | POST | 手动触发重新平衡检查 |
| `/api/claim-fees` | POST | 手动触发手续费领取 |

## 项目结构

```
cloudflare-bot/
├── src/
│   ├── index.ts           # Worker 入口
│   ├── types/
│   │   └── index.ts       # 类型定义
│   ├── config/
│   │   └── index.ts       # 配置管理
│   ├── services/
│   │   ├── rebalancer.ts  # 重新平衡核心逻辑
│   │   └── valueTracker.ts # 价值追踪服务
│   └── utils/
│       └── logger.ts      # 日志工具
├── migrations/
│   └── 0001_init.sql      # D1 数据库初始化
├── wrangler.toml          # Cloudflare 配置
├── .dev.vars.example      # 环境变量示例
└── package.json
```

## 与原版区别

| 特性 | 原版 (Node.js) | Cloudflare Workers 版 |
|------|---------------|----------------------|
| 运行环境 | 持续运行进程 | 无服务器函数 |
| 数据存储 | SQLite 文件 | Cloudflare D1 |
| 定时任务 | setInterval | Cron Triggers |
| 部署方式 | 服务器/VPS | Cloudflare 边缘网络 |
| 成本 | 服务器费用 | 按请求计费 (有免费额度) |

## 常用命令

```bash
# 本地开发
npm run dev

# 部署到 Cloudflare
npm run deploy

# 查看日志
npx wrangler tail

# 执行数据库迁移
npx wrangler d1 execute meteora-bot --file=./migrations/0001_init.sql
```

## 注意事项

1. **RPC 节点**: 建议使用付费 RPC 节点 (如 Helius, QuickNode) 以获得更好的稳定性
2. **私钥安全**: 使用 `wrangler secret` 管理私钥，不要提交到代码仓库
3. **Cron 频率**: 默认每分钟执行一次，可根据需要调整
4. **费用**: Cloudflare Workers 有免费额度，超出后按请求计费
