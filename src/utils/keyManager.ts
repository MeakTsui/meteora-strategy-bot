import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// ============================================================================
// 类型定义
// ============================================================================

interface EncryptedKeyFile {
  version: number;
  algorithm: string;
  salt: string;        // hex
  iv: string;          // hex
  authTag: string;     // hex
  encryptedKey: string; // hex
  publicKey: string;   // base58，用于验证解密是否正确
}

// ============================================================================
// 加密配置
// ============================================================================

const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-gcm',
  keyLength: 32,        // 256 bits
  saltLength: 32,       // 256 bits
  ivLength: 16,         // 128 bits
  iterations: 100000,   // PBKDF2 迭代次数
  digest: 'sha512',
};

// ============================================================================
// 密钥管理类
// ============================================================================

export class KeyManager {
  private keypair: Keypair | null = null;

  /**
   * 从密码派生加密密钥
   */
  private deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      password,
      salt,
      ENCRYPTION_CONFIG.iterations,
      ENCRYPTION_CONFIG.keyLength,
      ENCRYPTION_CONFIG.digest
    );
  }

  /**
   * 加密私钥
   */
  encryptPrivateKey(privateKey: Uint8Array, password: string): EncryptedKeyFile {
    const salt = crypto.randomBytes(ENCRYPTION_CONFIG.saltLength);
    const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);
    const key = this.deriveKey(password, salt);

    const cipher = crypto.createCipheriv(
      ENCRYPTION_CONFIG.algorithm as crypto.CipherGCMTypes,
      key,
      iv
    ) as crypto.CipherGCM;
    
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(privateKey)),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // 获取公钥用于验证
    const keypair = Keypair.fromSecretKey(privateKey);
    const publicKey = keypair.publicKey.toBase58();

    return {
      version: 1,
      algorithm: ENCRYPTION_CONFIG.algorithm,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encryptedKey: encrypted.toString('hex'),
      publicKey,
    };
  }

  /**
   * 解密私钥
   */
  decryptPrivateKey(encryptedFile: EncryptedKeyFile, password: string): Uint8Array {
    const salt = Buffer.from(encryptedFile.salt, 'hex');
    const iv = Buffer.from(encryptedFile.iv, 'hex');
    const authTag = Buffer.from(encryptedFile.authTag, 'hex');
    const encryptedKey = Buffer.from(encryptedFile.encryptedKey, 'hex');

    const key = this.deriveKey(password, salt);

    const decipher = crypto.createDecipheriv(
      ENCRYPTION_CONFIG.algorithm as crypto.CipherGCMTypes,
      key,
      iv
    ) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(encryptedKey),
        decipher.final(),
      ]);

      // 验证解密结果
      const keypair = Keypair.fromSecretKey(new Uint8Array(decrypted));
      if (keypair.publicKey.toBase58() !== encryptedFile.publicKey) {
        throw new Error('解密验证失败：公钥不匹配');
      }

      return new Uint8Array(decrypted);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unsupported state')) {
        throw new Error('密码错误或文件已损坏');
      }
      throw error;
    }
  }

  /**
   * 保存加密密钥到文件
   */
  saveEncryptedKey(encryptedFile: EncryptedKeyFile, filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(encryptedFile, null, 2), 'utf-8');
    // 设置文件权限为仅所有者可读写
    fs.chmodSync(filePath, 0o600);
  }

  /**
   * 从文件加载加密密钥
   */
  loadEncryptedKey(filePath: string): EncryptedKeyFile {
    if (!fs.existsSync(filePath)) {
      throw new Error(`加密密钥文件不存在: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as EncryptedKeyFile;
  }

  /**
   * 从终端读取密码（隐藏输入）
   */
  async promptPassword(prompt: string = '请输入密码: '): Promise<string> {
    // 尝试使用 raw mode 隐藏输入
    return new Promise((resolve, reject) => {
      process.stdout.write(prompt);
      
      const stdin = process.stdin;
      let password = '';
      
      // 检查是否支持 raw mode
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        const onData = (char: string) => {
          if (char === '\n' || char === '\r' || char === '\u0004') {
            stdin.setRawMode(false);
            stdin.removeListener('data', onData);
            stdin.pause();
            process.stdout.write('\n');
            resolve(password);
          } else if (char === '\u0003') {
            // Ctrl+C
            stdin.setRawMode(false);
            process.stdout.write('\n');
            process.exit(0);
          } else if (char === '\u007F' || char === '\b') {
            // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else if (char.charCodeAt(0) >= 32) {
            // 只接受可打印字符
            password += char;
            process.stdout.write('*');
          }
        };
        stdin.on('data', onData);
      } else {
        // 回退：使用 readline（密码会显示，但至少能工作）
        console.warn('\n⚠️  警告：当前终端不支持隐藏输入，密码将可见');
        const rl = readline.createInterface({
          input: stdin,
          output: process.stdout,
        });
        rl.question('', (answer) => {
          rl.close();
          resolve(answer);
        });
      }
    });
  }

  /**
   * 从加密文件加载钱包（交互式输入密码）
   */
  async loadWalletFromEncryptedFile(filePath: string): Promise<Keypair> {
    const encryptedFile = this.loadEncryptedKey(filePath);
    
    console.log(`\n🔐 加密密钥文件: ${path.basename(filePath)}`);
    console.log(`   公钥: ${encryptedFile.publicKey}`);
    
    const password = await this.promptPassword('\n请输入解密密码: ');
    
    if (!password) {
      throw new Error('密码不能为空');
    }

    console.log('正在解密...');
    const privateKey = this.decryptPrivateKey(encryptedFile, password);
    
    this.keypair = Keypair.fromSecretKey(privateKey);
    
    console.log('✅ 钱包解密成功\n');
    
    return this.keypair;
  }

  /**
   * 从环境变量加载钱包（兼容旧方式）
   */
  loadWalletFromEnv(): Keypair {
    const privateKeyStr = process.env.WALLET_PRIVATE_KEY;
    const mnemonic = process.env.WALLET_MNEMONIC;

    if (privateKeyStr) {
      const privateKey = bs58.decode(privateKeyStr.trim());
      this.keypair = Keypair.fromSecretKey(privateKey);
      return this.keypair;
    }

    if (mnemonic) {
      const bip39 = require('bip39');
      const { derivePath } = require('ed25519-hd-key');
      
      if (!bip39.validateMnemonic(mnemonic.trim())) {
        throw new Error('无效的助记词');
      }
      
      const seed = bip39.mnemonicToSeedSync(mnemonic.trim(), '');
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
      this.keypair = Keypair.fromSeed(derivedSeed);
      return this.keypair;
    }

    throw new Error('未找到钱包配置');
  }

  /**
   * 智能加载钱包：优先使用加密文件，否则使用环境变量
   */
  async loadWallet(encryptedKeyPath?: string): Promise<Keypair> {
    // 优先使用加密密钥文件
    const keyPath = encryptedKeyPath || process.env.ENCRYPTED_KEY_PATH;
    
    if (keyPath && fs.existsSync(keyPath)) {
      return this.loadWalletFromEncryptedFile(keyPath);
    }

    // 回退到环境变量
    console.log('⚠️  使用环境变量中的私钥（不推荐用于生产环境）');
    return this.loadWalletFromEnv();
  }

  /**
   * 获取当前钱包
   */
  getKeypair(): Keypair {
    if (!this.keypair) {
      throw new Error('钱包未加载');
    }
    return this.keypair;
  }

  /**
   * 清理内存中的密钥
   */
  clearKeys(): void {
    if (this.keypair) {
      // 尝试清零私钥内存
      const secretKey = this.keypair.secretKey;
      for (let i = 0; i < secretKey.length; i++) {
        secretKey[i] = 0;
      }
      this.keypair = null;
    }
  }
}

// 导出单例
let keyManagerInstance: KeyManager | null = null;

export function getKeyManager(): KeyManager {
  if (!keyManagerInstance) {
    keyManagerInstance = new KeyManager();
  }
  return keyManagerInstance;
}
