-- ============================================================================
-- Meteora DLMM Bid-Ask Rebalancer - D1 数据库初始化
-- ============================================================================

-- 价值快照表
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  total_value_usd REAL NOT NULL,
  current_price REAL NOT NULL,
  positions TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);

-- 操作记录表
CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  position_key TEXT NOT NULL,
  action TEXT NOT NULL,
  before_value_usd REAL NOT NULL,
  after_value_usd REAL NOT NULL,
  amount_processed REAL NOT NULL,
  tx_signature TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operations_timestamp ON operations(timestamp);
CREATE INDEX IF NOT EXISTS idx_operations_position ON operations(position_key);

-- 每日 PnL 表
CREATE TABLE IF NOT EXISTS daily_pnl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  open_value REAL NOT NULL,
  close_value REAL NOT NULL,
  high_value REAL NOT NULL,
  low_value REAL NOT NULL,
  pnl REAL NOT NULL,
  pnl_percent REAL NOT NULL,
  operations INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_pnl_date ON daily_pnl(date);

-- 已领取手续费记录表
CREATE TABLE IF NOT EXISTS claimed_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  position_key TEXT NOT NULL,
  tx_signature TEXT UNIQUE,
  claimed_x REAL NOT NULL,
  claimed_y REAL NOT NULL,
  claimed_x_usd REAL NOT NULL,
  claimed_y_usd REAL NOT NULL,
  total_claimed_usd REAL NOT NULL,
  price_at_claim REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_claimed_fees_timestamp ON claimed_fees(timestamp);
CREATE INDEX IF NOT EXISTS idx_claimed_fees_position ON claimed_fees(position_key);

-- 仓位价格历史表（记录买入/卖出均价）
CREATE TABLE IF NOT EXISTS position_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_key TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  price_type TEXT NOT NULL,
  avg_price REAL NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_position_price_key ON position_price_history(position_key);
CREATE INDEX IF NOT EXISTS idx_position_price_type ON position_price_history(position_key, price_type);
