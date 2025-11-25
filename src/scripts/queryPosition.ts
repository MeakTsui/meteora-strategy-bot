import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import bs58 from "bs58";
import dotenv from "dotenv";
import BN from "bn.js";

dotenv.config();

/**
 * 将十六进制字符串转换为数字
 */
function hexToNumber(hex: string): number {
  if (!hex || hex === "00") return 0;
  return parseInt(hex, 16);
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
    
    // 获取当前活跃 bin
    const activeBin = await dlmmPool.getActiveBin();
    console.log(`   当前活跃 Bin ID: ${activeBin.binId}`);
    console.log(`   当前价格: ${formatPrice(activeBin.pricePerToken)}`);

    // 获取用户在该池中的所有仓位
    console.log("\n" + "=".repeat(80));
    console.log("📦 查询用户仓位...");
    console.log("=".repeat(80));

    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
      userPubkey
    );

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

      // 解析十六进制数据
      const totalXAmount = hexToNumber(posData.totalXAmount as any);
      const totalYAmount = hexToNumber(posData.totalYAmount as any);
      const feeX = hexToNumber(posData.feeX as any);
      const feeY = hexToNumber(posData.feeY as any);
      const lowerBinId = typeof posData.lowerBinId === 'string' ? hexToNumber(posData.lowerBinId) : posData.lowerBinId;
      const upperBinId = typeof posData.upperBinId === 'string' ? hexToNumber(posData.upperBinId) : posData.upperBinId;

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
      const rewardOne = hexToNumber(posData.rewardOne as any);
      const rewardTwo = hexToNumber(posData.rewardTwo as any);
      
      if (rewardOne > 0 || rewardTwo > 0) {
        console.log("\n🎁 奖励信息:");
        if (rewardOne > 0) {
          console.log(`   奖励 Token 1: ${rewardOne.toLocaleString()}`);
        }
        if (rewardTwo > 0) {
          console.log(`   奖励 Token 2: ${rewardTwo.toLocaleString()}`);
        }
      }

      // 显示详细的 Bin 信息
      if (positionBinData && positionBinData.length > 0 && positionBinData.length <= 10) {
        console.log("\n📊 各 Bin 详情:");
        positionBinData.forEach((bin, idx) => {
          const posX = typeof bin.positionXAmount === 'string' ? parseFloat(bin.positionXAmount) : bin.positionXAmount;
          const posY = typeof bin.positionYAmount === 'string' ? parseFloat(bin.positionYAmount) : bin.positionYAmount;
          const price = typeof bin.price === 'string' ? parseFloat(bin.price) : bin.price;
          
          console.log(`\n   Bin #${idx + 1} (ID: ${bin.binId}):`);
          console.log(`      价格: ${formatPrice(price)}`);
          console.log(`      Token X: ${formatAmount(posX, tokenXDecimals)}`);
          console.log(`      Token Y: ${formatAmount(posY, tokenYDecimals)}`);
        });
      } else if (positionBinData && positionBinData.length > 10) {
        console.log(`\n   ℹ️  Bin 数量较多 (${positionBinData.length} 个)，已省略详细信息`);
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
