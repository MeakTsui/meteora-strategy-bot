import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import bs58 from "bs58";
import dotenv from "dotenv";
import BN from "bn.js";

dotenv.config();

/**
 * 终端柱状图配置
 */
const CHART_CONFIG = {
  maxWidth: 50,      // 柱状图最大宽度
  barCharFull: '█',  // 满格字符
  barCharHalf: '▌',  // 半格字符
  barCharEmpty: '░', // 空格字符
};

/**
 * 绘制终端柱状图
 */
function drawBarChart(
  data: { label: string; valueX: number; valueY: number; isActive?: boolean }[],
  tokenXDecimals: number,
  tokenYDecimals: number
): void {
  if (data.length === 0) return;

  // 计算最大值用于归一化
  const maxX = Math.max(...data.map(d => d.valueX), 1);
  const maxY = Math.max(...data.map(d => d.valueY), 1);

  // 找到最长的标签用于对齐
  const maxLabelLen = Math.max(...data.map(d => d.label.length), 8);

  console.log('\n' + '─'.repeat(80));
  console.log('📊 Bin 分布柱状图');
  console.log('─'.repeat(80));
  
  // 图例
  console.log(`\n   ${'Bin ID'.padEnd(maxLabelLen)}  Token X (左) | Token Y (右)`);
  console.log(`   ${''.padEnd(maxLabelLen)}  ${CHART_CONFIG.barCharFull.repeat(5)} X    ${CHART_CONFIG.barCharFull.repeat(5)} Y\n`);

  data.forEach(item => {
    const normalizedX = Math.round((item.valueX / maxX) * CHART_CONFIG.maxWidth);
    const normalizedY = Math.round((item.valueY / maxY) * CHART_CONFIG.maxWidth);

    // 格式化数值显示
    const xAmount = (item.valueX / Math.pow(10, tokenXDecimals)).toFixed(4);
    const yAmount = (item.valueY / Math.pow(10, tokenYDecimals)).toFixed(2);

    // 活跃 bin 标记
    const activeMarker = item.isActive ? ' ◀ ACTIVE' : '';
    
    // 绘制 Token X 柱状图（蓝色）
    const barX = CHART_CONFIG.barCharFull.repeat(normalizedX) + 
                 CHART_CONFIG.barCharEmpty.repeat(CHART_CONFIG.maxWidth - normalizedX);
    
    // 绘制 Token Y 柱状图（绿色）  
    const barY = CHART_CONFIG.barCharFull.repeat(normalizedY) +
                 CHART_CONFIG.barCharEmpty.repeat(CHART_CONFIG.maxWidth - normalizedY);

    // 输出行
    console.log(`   ${item.label.padEnd(maxLabelLen)}  \x1b[34m${barX}\x1b[0m ${xAmount.padStart(10)}`);
    console.log(`   ${''.padEnd(maxLabelLen)}  \x1b[32m${barY}\x1b[0m ${yAmount.padStart(10)}${activeMarker}`);
    console.log('');
  });

  // 显示汇总
  const totalX = data.reduce((sum, d) => sum + d.valueX, 0);
  const totalY = data.reduce((sum, d) => sum + d.valueY, 0);
  console.log('─'.repeat(80));
  console.log(`   总计: Token X = ${(totalX / Math.pow(10, tokenXDecimals)).toFixed(6)}, Token Y = ${(totalY / Math.pow(10, tokenYDecimals)).toFixed(2)}`);
}

/**
 * 绘制简化的水平柱状图（单行显示，使用价格显示）
 */
function drawSimpleBarChart(
  data: { binId: number; price: number; valueX: number; valueY: number; isActive?: boolean }[],
  tokenXDecimals: number,
  tokenYDecimals: number,
  activeBinId: number
): void {
  if (data.length === 0) return;

  // 按价格排序（从低到高）
  const sortedData = [...data].sort((a, b) => a.price - b.price);

  // 计算最大值
  const maxX = Math.max(...sortedData.map(d => d.valueX), 1);
  const maxY = Math.max(...sortedData.map(d => d.valueY), 1);
  const maxTotal = Math.max(maxX, maxY);

  console.log('\n' + '═'.repeat(80));
  console.log('📊 价格区间流动性分布图');
  console.log('═'.repeat(80));
  console.log(`\n   \x1b[34m█\x1b[0m Token X    \x1b[32m█\x1b[0m Token Y    \x1b[33m◆\x1b[0m 当前价格位置\n`);

  sortedData.forEach(item => {
    const isActive = item.binId === activeBinId;
    const barWidth = 35;
    
    // 计算柱状图长度
    const lenX = Math.round((item.valueX / maxTotal) * barWidth);
    const lenY = Math.round((item.valueY / maxTotal) * barWidth);

    // 格式化数值
    const xDisplay = (item.valueX / Math.pow(10, tokenXDecimals)).toFixed(4);
    const yDisplay = (item.valueY / Math.pow(10, tokenYDecimals)).toFixed(2);

    // 活跃标记
    const marker = isActive ? '\x1b[33m◆\x1b[0m' : ' ';
    
    // 使用价格作为标签，保留适当精度
    const priceLabel = `$${item.price.toFixed(4)}`.padEnd(14);

    // 组合柱状图
    const barX = '\x1b[34m' + CHART_CONFIG.barCharFull.repeat(lenX) + '\x1b[0m';
    const barY = '\x1b[32m' + CHART_CONFIG.barCharFull.repeat(lenY) + '\x1b[0m';
    const padding = ' '.repeat(Math.max(0, barWidth - lenX - lenY));

    console.log(`${marker} ${priceLabel} ${barX}${barY}${padding} X:${xDisplay} Y:${yDisplay}`);
  });

  // 汇总信息
  const totalX = sortedData.reduce((sum, d) => sum + d.valueX, 0);
  const totalY = sortedData.reduce((sum, d) => sum + d.valueY, 0);
  const minPrice = sortedData[0]?.price || 0;
  const maxPrice = sortedData[sortedData.length - 1]?.price || 0;
  
  console.log('\n' + '─'.repeat(80));
  console.log(`   📈 价格范围: $${minPrice.toFixed(4)} ~ $${maxPrice.toFixed(4)}`);
  console.log(`   💰 汇总: Token X = ${(totalX / Math.pow(10, tokenXDecimals)).toFixed(6)}, Token Y = ${(totalY / Math.pow(10, tokenYDecimals)).toFixed(2)}`);
  console.log('═'.repeat(80));
}

/**
 * 安全地将 BN 或其他类型转换为数字
 */
function toNumber(value: any): number {
  if (!value) return 0;
  if (value instanceof BN) return value.toNumber();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // 处理十六进制字符串
    if (value.startsWith('0x')) return parseInt(value, 16);
    return parseFloat(value) || 0;
  }
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

/**
 * 格式化 Token 数量（添加千分位分隔符）
 */
function formatAmount(amount: number | string, decimals: number = 0): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (decimals > 0) {
    return (num / Math.pow(10, decimals)).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  }
  return num.toLocaleString("zh-CN");
}

/**
 * 格式化价格
 */
function formatPrice(price: number | string): string {
  const num = typeof price === "string" ? parseFloat(price) : price;
  return num.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

/**
 * 从私钥或助记词创建钱包
 */
function createWalletFromSecret(secret: string): Keypair {
  // 尝试判断是私钥还是助记词
  const trimmedSecret = secret.trim();
  
  // 如果包含空格，很可能是助记词
  if (trimmedSecret.includes(" ")) {
    console.log("检测到助记词格式，正在导入...");
    try {
      // 导入 bip39 和 derivation path
      const bip39 = require("bip39");
      const { derivePath } = require("ed25519-hd-key");
      
      // 验证助记词
      if (!bip39.validateMnemonic(trimmedSecret)) {
        throw new Error("无效的助记词");
      }
      
      // 从助记词生成种子
      const seed = bip39.mnemonicToSeedSync(trimmedSecret, "");
      
      // 使用 Solana 标准派生路径 m/44'/501'/0'/0'
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString("hex")).key;
      
      return Keypair.fromSeed(derivedSeed);
    } catch (error) {
      throw new Error(`助记词导入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    // 尝试作为 Base58 私钥解析
    console.log("检测到私钥格式，正在导入...");
    try {
      const secretKey = bs58.decode(trimmedSecret);
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      throw new Error(`私钥导入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * 查询钱包在指定 DLMM 池中的仓位和手续费信息
 */
async function queryPosition() {
  try {
    // 从环境变量读取配置
    const rpcUrl = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
    const walletSecret = process.env.WALLET_PRIVATE_KEY || process.env.WALLET_MNEMONIC;
    
    // 从命令行参数获取池地址，如果没有则使用默认值
    const poolAddress = process.argv[2] || "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

    if (!walletSecret) {
      throw new Error("请在 .env 文件中配置 WALLET_PRIVATE_KEY 或 WALLET_MNEMONIC");
    }

    console.log("=".repeat(80));
    console.log("🔍 开始查询仓位信息");
    console.log("=".repeat(80));

    // 初始化连接和钱包
    const connection = new Connection(rpcUrl, "confirmed");
    const wallet = createWalletFromSecret(walletSecret);
    const userPubkey = wallet.publicKey;

    console.log(`\n📍 RPC 节点: ${rpcUrl}`);
    console.log(`💼 钱包地址: ${userPubkey.toBase58()}`);
    console.log(`🏊 池地址: ${poolAddress}\n`);

    // 创建 DLMM 池实例
    const poolPubkey = new PublicKey(poolAddress);
    const dlmmPool = await DLMM.create(connection, poolPubkey);

    // 获取 Token 信息（使用默认精度）
    const tokenXDecimals = dlmmPool.tokenX.mint.decimals; // SOL
    const tokenYDecimals = dlmmPool.tokenY.mint.decimals; // USDC

    console.log("📊 池信息:");
    // console.log("   Token X: ", dlmmPool.tokenX.mint.toBase58());
    // console.log("   Token Y: ", dlmmPool.tokenY.mint.toBase58());
    console.log(`   Token X: ${dlmmPool.tokenX.publicKey.toBase58()} (精度: ${tokenXDecimals})`);
    console.log(`   Token Y: ${dlmmPool.tokenY.publicKey.toBase58()} (精度: ${tokenYDecimals})`);
    console.log(`   Bin Step: ${dlmmPool.lbPair.binStep}`);
    
    // 获取手续费信息
    const feeInfo = dlmmPool.getFeeInfo();
    const dynamicFee = dlmmPool.getDynamicFee();
    console.log(`   基础手续费率: ${feeInfo.baseFeeRatePercentage}%`);
    console.log(`   最大手续费率: ${feeInfo.maxFeeRatePercentage}%`);
    console.log(`   当前动态手续费: ${dynamicFee.toString()}%`);

    // 获取用户在该池中的所有仓位（同时返回 activeBin）
    console.log("\n" + "=".repeat(80));
    console.log("📦 查询用户仓位...");
    console.log("=".repeat(80));

    const { userPositions, activeBin } = await dlmmPool.getPositionsByUserAndLbPair(
      userPubkey
    );

    console.log(`\n📊 当前活跃 Bin ID: ${activeBin.binId}`);
    console.log(`   当前价格: ${formatPrice(activeBin.pricePerToken)}`);

    if (userPositions.length === 0) {
      console.log("\n❌ 未找到任何仓位");
      return;
    }

    console.log(`\n✅ 找到 ${userPositions.length} 个仓位\n`);

    // 遍历每个仓位，显示详细信息
    for (let i = 0; i < userPositions.length; i++) {
      const position = userPositions[i];
      const posData = position.positionData;
      
      console.log("─".repeat(80));
      console.log(`📍 仓位 #${i + 1}`);
      console.log("─".repeat(80));
      console.log(`   仓位地址: ${position.publicKey.toBase58()}`);
      console.log(`   所有者: ${posData.owner.toBase58()}`);

      // 安全解析数据（SDK 返回的可能是 BN 类型）
      const totalXAmount = toNumber(posData.totalXAmount);
      const totalYAmount = toNumber(posData.totalYAmount);
      const feeX = toNumber(posData.feeX);
      const feeY = toNumber(posData.feeY);
      const lowerBinId = toNumber(posData.lowerBinId);
      const upperBinId = toNumber(posData.upperBinId);

      // 判断仓位是否在当前价格范围内
      const isInRange = activeBin.binId >= lowerBinId && activeBin.binId <= upperBinId;
      console.log(`   状态: ${isInRange ? '🟢 在范围内' : '🔴 超出范围'}`);

      // 显示流动性信息
      console.log("\n💰 流动性总览:");
      console.log(`   Token X 总量: ${formatAmount(totalXAmount, tokenXDecimals)} (原始: ${totalXAmount.toLocaleString()})`);
      console.log(`   Token Y 总量: ${formatAmount(totalYAmount, tokenYDecimals)} (原始: ${totalYAmount.toLocaleString()})`);
      console.log(`   Bin ID 范围: ${lowerBinId} → ${upperBinId}`);
      
      const positionBinData = posData.positionBinData;
      if (positionBinData && positionBinData.length > 0) {
        console.log(`   活跃 Bin 数量: ${positionBinData.length}`);
        
        // 计算总的仓位金额
        let totalPosX = 0;
        let totalPosY = 0;
        let totalFeeX = 0;
        let totalFeeY = 0;
        
        positionBinData.forEach((bin) => {
          const posX = typeof bin.positionXAmount === 'string' ? parseFloat(bin.positionXAmount) : bin.positionXAmount;
          const posY = typeof bin.positionYAmount === 'string' ? parseFloat(bin.positionYAmount) : bin.positionYAmount;
          const fX = typeof bin.positionFeeXAmount === 'string' ? parseFloat(bin.positionFeeXAmount) : bin.positionFeeXAmount;
          const fY = typeof bin.positionFeeYAmount === 'string' ? parseFloat(bin.positionFeeYAmount) : bin.positionFeeYAmount;
          
          totalPosX += posX;
          totalPosY += posY;
          totalFeeX += fX;
          totalFeeY += fY;
        });
        
        console.log(`\n   各 Bin 汇总:`);
        console.log(`   Token X 仓位: ${formatAmount(totalPosX, tokenXDecimals)}`);
        console.log(`   Token Y 仓位: ${formatAmount(totalPosY, tokenYDecimals)}`);
      }

      // 显示手续费信息
      console.log("\n💵 手续费信息:");
      console.log(`   可领取 Token X 手续费: ${formatAmount(feeX, tokenXDecimals)} (原始: ${feeX.toLocaleString()})`);
      console.log(`   可领取 Token Y 手续费: ${formatAmount(feeY, tokenYDecimals)} (原始: ${feeY.toLocaleString()})`);
      
      // 显示奖励信息
      const rewardOne = toNumber(posData.rewardOne);
      const rewardTwo = toNumber(posData.rewardTwo);
      
      if (rewardOne > 0 || rewardTwo > 0) {
        console.log("\n🎁 奖励信息:");
        if (rewardOne > 0) {
          console.log(`   奖励 Token 1: ${rewardOne.toLocaleString()}`);
        }
        if (rewardTwo > 0) {
          console.log(`   奖励 Token 2: ${rewardTwo.toLocaleString()}`);
        }
      }

      // 绘制柱状图
      if (positionBinData && positionBinData.length > 0) {
        const chartData = positionBinData.map(bin => ({
          binId: bin.binId,
          price: typeof bin.price === 'string' ? parseFloat(bin.price) : bin.price,
          valueX: typeof bin.positionXAmount === 'string' ? parseFloat(bin.positionXAmount) : bin.positionXAmount,
          valueY: typeof bin.positionYAmount === 'string' ? parseFloat(bin.positionYAmount) : bin.positionYAmount,
          isActive: bin.binId === activeBin.binId,
        }));

        // 使用简化柱状图显示
        drawSimpleBarChart(chartData, tokenXDecimals, tokenYDecimals, activeBin.binId);

        // 如果 bin 数量较少，也显示详细信息
        if (positionBinData.length <= 10) {
          console.log("\n� 各 Bin 详情:");
          positionBinData.forEach((bin, idx) => {
            const posX = typeof bin.positionXAmount === 'string' ? parseFloat(bin.positionXAmount) : bin.positionXAmount;
            const posY = typeof bin.positionYAmount === 'string' ? parseFloat(bin.positionYAmount) : bin.positionYAmount;
            const price = typeof bin.price === 'string' ? parseFloat(bin.price) : bin.price;
            const isActive = bin.binId === activeBin.binId;
            
            console.log(`\n   Bin #${idx + 1} (ID: ${bin.binId})${isActive ? ' \x1b[33m◀ ACTIVE\x1b[0m' : ''}:`);
            console.log(`      价格: ${formatPrice(price)}`);
            console.log(`      Token X: ${formatAmount(posX, tokenXDecimals)}`);
            console.log(`      Token Y: ${formatAmount(posY, tokenYDecimals)}`);
          });
        }
      }

      console.log("\n");
    }

    console.log("=".repeat(80));
    console.log("✅ 查询完成");
    console.log("=".repeat(80));

  } catch (error) {
    console.error("\n❌ 查询失败:");
    console.error(error);
    process.exit(1);
  }
}

// 执行查询
queryPosition().then(() => {
  process.exit(0);
});
