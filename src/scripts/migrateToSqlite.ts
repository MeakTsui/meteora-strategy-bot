/**
 * 数据迁移脚本：从 JSON 文件迁移到 SQLite 数据库
 */
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'tracker.db');

// JSON 文件路径
const snapshotsFile = path.join(dataDir, 'snapshots.json');
const operationsFile = path.join(dataDir, 'operations.json');
const dailyPnLFile = path.join(dataDir, 'daily_pnl.json');

console.log('开始迁移数据到 SQLite...');
console.log(`数据目录: ${dataDir}`);
console.log(`数据库: ${dbPath}`);

// 打开数据库
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 迁移快照数据
if (fs.existsSync(snapshotsFile)) {
  console.log('\n正在迁移快照数据...');
  const snapshots = JSON.parse(fs.readFileSync(snapshotsFile, 'utf-8'));
  
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO snapshots (timestamp, total_value_usd, current_price, positions)
    VALUES (?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((items: any[]) => {
    for (const item of items) {
      insertStmt.run(
        item.timestamp,
        item.totalValueUSD,
        item.currentPrice,
        JSON.stringify(item.positions)
      );
    }
  });
  
  insertMany(snapshots);
  console.log(`  已迁移 ${snapshots.length} 条快照记录`);
}

// 迁移操作记录
if (fs.existsSync(operationsFile)) {
  console.log('\n正在迁移操作记录...');
  const operations = JSON.parse(fs.readFileSync(operationsFile, 'utf-8'));
  
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO operations (timestamp, position_key, action, before_value_usd, after_value_usd, amount_processed, tx_signature)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((items: any[]) => {
    for (const item of items) {
      insertStmt.run(
        item.timestamp,
        item.positionKey,
        item.action,
        item.beforeValueUSD,
        item.afterValueUSD,
        item.amountProcessed,
        item.txSignature || null
      );
    }
  });
  
  insertMany(operations);
  console.log(`  已迁移 ${operations.length} 条操作记录`);
}

// 迁移每日 PnL
if (fs.existsSync(dailyPnLFile)) {
  console.log('\n正在迁移每日 PnL 数据...');
  const dailyPnL = JSON.parse(fs.readFileSync(dailyPnLFile, 'utf-8'));
  
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO daily_pnl (date, open_value, close_value, high_value, low_value, pnl, pnl_percent, operations)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((items: any[]) => {
    for (const item of items) {
      insertStmt.run(
        item.date,
        item.openValue,
        item.closeValue,
        item.highValue,
        item.lowValue,
        item.pnl,
        item.pnlPercent,
        item.operations
      );
    }
  });
  
  insertMany(dailyPnL);
  console.log(`  已迁移 ${dailyPnL.length} 条每日 PnL 记录`);
}

// 显示统计
console.log('\n迁移完成！数据库统计：');
const snapshotCount = (db.prepare('SELECT COUNT(*) as count FROM snapshots').get() as any).count;
const operationCount = (db.prepare('SELECT COUNT(*) as count FROM operations').get() as any).count;
const dailyPnLCount = (db.prepare('SELECT COUNT(*) as count FROM daily_pnl').get() as any).count;

console.log(`  快照记录: ${snapshotCount}`);
console.log(`  操作记录: ${operationCount}`);
console.log(`  每日 PnL: ${dailyPnLCount}`);

db.close();

console.log('\n可以安全删除旧的 JSON 文件：');
console.log(`  rm ${snapshotsFile}`);
console.log(`  rm ${operationsFile}`);
console.log(`  rm ${dailyPnLFile}`);
