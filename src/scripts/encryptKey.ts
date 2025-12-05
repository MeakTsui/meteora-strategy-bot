/**
 * 私钥加密工具
 * 
 * 使用方法：
 *   npx ts-node src/scripts/encryptKey.ts
 * 
 * 功能：
 *   1. 输入私钥（Base58 格式）或助记词
 *   2. 输入加密密码
 *   3. 生成加密密钥文件
 */

import * as readline from 'readline';
import * as path from 'path';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { KeyManager } from '../utils/keyManager';

// ============================================================================
// 工具函数
// ============================================================================

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function questionHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    
    if (!process.stdin.isTTY) {
      const rl = createReadlineInterface();
      rl.question('', (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (char: string) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        stdin.pause();
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        // Ctrl+C
        console.log('\n已取消');
        process.exit(0);
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        input += char;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function parsePrivateKey(input: string): Uint8Array {
  const trimmed = input.trim();
  
  // 检查是否是助记词（包含空格）
  if (trimmed.includes(' ')) {
    const bip39 = require('bip39');
    const { derivePath } = require('ed25519-hd-key');
    
    if (!bip39.validateMnemonic(trimmed)) {
      throw new Error('无效的助记词');
    }
    
    const seed = bip39.mnemonicToSeedSync(trimmed, '');
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    const keypair = Keypair.fromSeed(derivedSeed);
    return keypair.secretKey;
  }
  
  // 尝试 Base58 解码
  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length === 64) {
      return decoded;
    }
    throw new Error('私钥长度不正确');
  } catch {
    throw new Error('无效的私钥格式（需要 Base58 编码的私钥或助记词）');
  }
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new Error('密码长度至少 8 位');
  }
  
  // 检查密码强度
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  
  const strength = [hasLower, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;
  
  if (strength < 2) {
    console.log('⚠️  警告：密码强度较弱，建议包含大小写字母、数字和特殊字符');
  }
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                         私钥加密工具                                         ║
║                                                                              ║
║  此工具将您的私钥加密存储，保护私钥安全                                        ║
║  加密后的文件可以安全地上传到服务器                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  const rl = createReadlineInterface();
  const keyManager = new KeyManager();

  try {
    // 1. 输入私钥
    console.log('请输入私钥（Base58 格式）或助记词：');
    const privateKeyInput = await questionHidden('> ');
    
    if (!privateKeyInput) {
      throw new Error('私钥不能为空');
    }

    // 解析私钥
    const privateKey = parsePrivateKey(privateKeyInput);
    const keypair = Keypair.fromSecretKey(privateKey);
    
    console.log(`\n✅ 私钥解析成功`);
    console.log(`   公钥: ${keypair.publicKey.toBase58()}`);

    // 2. 输入密码
    console.log('\n请设置加密密码（至少 8 位）：');
    const password = await questionHidden('> ');
    
    validatePassword(password);

    // 3. 确认密码
    console.log('\n请再次输入密码确认：');
    const passwordConfirm = await questionHidden('> ');
    
    if (password !== passwordConfirm) {
      throw new Error('两次输入的密码不一致');
    }

    // 4. 加密
    console.log('\n正在加密...');
    const encryptedFile = keyManager.encryptPrivateKey(privateKey, password);

    // 5. 保存文件
    const outputPath = path.join(process.cwd(), 'encrypted_key.json');
    keyManager.saveEncryptedKey(encryptedFile, outputPath);

    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                           ✅ 加密完成                                        ║
╚══════════════════════════════════════════════════════════════════════════════╝

  加密文件: ${outputPath}
  公钥地址: ${encryptedFile.publicKey}

  ⚠️  重要提示：
  1. 请妥善保管加密密码，密码丢失将无法恢复私钥
  2. 建议在安全的地方备份原始私钥
  3. 上传到服务器后，删除本地的 .env 中的私钥配置
  4. 在服务器上设置环境变量: ENCRYPTED_KEY_PATH=/path/to/encrypted_key.json

  使用方法：
  1. 将 encrypted_key.json 上传到服务器
  2. 启动程序时会提示输入密码
  3. 输入正确密码后程序开始运行
`);

  } catch (error) {
    console.error(`\n❌ 错误: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
