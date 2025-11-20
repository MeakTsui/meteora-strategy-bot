# 自动化 DLMM 区间策略机器人 —— Prompt 工程文档  
（用于让 AI 自动生成完整代码项目）

---

## 📌 使用方式  
将本文件内容完整复制到专业 AI 编码工具（如 Cursor、Windsurf、Continue、Claude Artifacts），AI 会根据文档自动生成：  
- 完整可运行的 **DLMM 区间策略机器人**  
- 包含数据源、区间管理、策略逻辑、自动补仓、自动再部署等模块  
- 支持你的自定义参数、阈值、日志、风险控制

---

# 🎯 **目标策略概要（SOL 100–250 区间覆盖 + Bid-Ask 高频补仓）**  

你投入 **5000 USDT**，采用以下组合式策略自动运行：

### 1. **主收益：Bid-Ask 高频区间策略（70% 资金）**  
- 在价格区间 100–250 之间划分多个小区间（如 5 美金一档）  
- 当前价格处在某一区间（例如 140–145）时：  
  - **使用 Bid-Ask 模式并完全放 SOL**  
  - 等价格穿越上界（如 >145），立即提取并重建该区间流动性  
  - 赚取价差 / 复利  

### 2. **趋势跟随区间（20% 资金）**  
- 价格连续突破 n 个区间后才部署（如连破 3 档 ≈ 强趋势）  
- Deployment 逻辑：  
  - 强趋势向上 → 只放 SOL（等涨到极值卖出）  
  - 强趋势向下 → 只放 USDC（等反弹自动补仓）  

### 3. **远价“捞底保险区间”（10% 资金）**  
- 在主区间以外继续部署 2–3 个深距离档位（如 80/60/40）  
- 价格暴跌时提供极高收益的 LP，提升整体胜率  
- 小仓位防止拖累整体收益  

---

# 🧠 **AI 项目生成提示词（主 Prompt）**

下面内容用于让 AI 直接产出完整项目，请保持原样复制：

---

## **PROMPT（请在 AI 工具中一次性输入以下内容）**

你是一名顶级架构师 + 全栈工程师，请根据本 Prompt 自动生成一个能够直接运行的「SOL Meteora DLMM 区间做市机器人」项目。  
项目需要模块化、可扩展、可配置，代码需达到生产级别质量。

---

# 🚀 **项目要求**

## 1. **项目结构**
请生成如下结构：

```
/dlmm-bot  
  /src  
    config.ts  
    utils/  
    services/  
    strategies/  
    core/  
    api/  
  logs/  
  README.md  
  package.json  
```

---

# 2. **功能需求**

## (1) 价格数据模块（核心）
实现：

- 从 Helius / Jupiter / Birdeye 订阅 SOL 实时价格  
- 支持 fallback（其中一个失效自动切换）  
- 提供以下方法：

```
getPrice(): Promise<number>
subscribePrice(callback)
getOHLC(interval)
```

---

## (2) 区间划分模块
参数：

```
minPrice = 100  
maxPrice = 250  
gridSize = 5  
```

需要输出：

```
[ {lower:100, upper:105}, ..., {lower:245, upper:250} ]
```

并提供：

```
findCurrentRange(price)
getNextRange(range)
isBreakout(range, price)
```

---

## (3) Meteora DLMM 接口封装  
必须封装以下方法（模拟 + 主网均可切换）：

```
createPosition(range, mode)    # BID-ASK / SINGLE-SIDE
withdrawPosition(positionId)
rebalancePosition(...)
getPositionAPR(...)
getVaultStates(...)
```

要求：  
- 代码自动处理 token decimals  
- 自动计算存入 SOL 或 USDC 数量  
- 自动生成交易 Instruction  
- 提供 `simulate()` 输出收益变化  

---

# 3. **三类策略模块**

---

## **A. Bid-Ask 高频复利策略（主策略）**

### 参数
```
rangeWidth = 5  
redeployThreshold = 0.3%   # 价格穿越上界超 0.3% 就撤出重建
side = "SOL_ONLY"  
allocation = 70%
```

### 规则：
```
if price > range.upper * (1 + redeployThreshold):
    withdraw
    redeploy into same range with side=SOL_ONLY
```

输出：  
- 成交均价  
- 区间内卖出获得的 USDC  
- 吐出的 SOL  
- 复利次数  
- 年化

---

## **B. 趋势跟随区间（20%）**

逻辑：

```
if break N consecutive ranges UP:
    deploy SOL_ONLY in new upper range

if break N consecutive ranges DOWN:
    deploy USDC_ONLY in new lower range
```

---

## **C. 远价捞底保险（10%）**

区间示例：

```
80–100  
60–80  
40–60
```

规则：

```
only deploy when price crashes into the far range
withdraw when price rebounds 10%+
```

---

# 4. **机器人调度系统（核心循环）**

循环结构（每 分钟运行一次）：

```
price = getPrice()

updateActiveRanges()

for each activeRange:
    runMainStrategy(range, price)

for each trendRange:
    runTrendStrategy(range, price)

for each insuranceRange:
    runInsuranceStrategy(range, price)
```

要求：  
- 日志写入 `logs/yyyymmdd.log`  
- 严格捕获异常  
- 熔断机制（连续 5 次失败暂停交易）  
- 所有参数可在 config.ts 中修改  

---

# 5. **模拟器（必须有）**

提供一个 CLI：

```
npm run backtest
```

模拟内容：  
- 使用过去 30 天 SOL 价格  
- 输出各区间收益  
- 自动计算“复利次数 / 最大回撤 / 年化”  

---

# 6. **最终输出要求**

AI 必须生成：  
- 完整代码  
- 完整目录  
- 每个函数带注释  
- README（包含部署方式、env 示例、风险提示）  
- 可直接启动的版本：

```
npm install
npm run start
```

---

# 📦 完整 Prompt 结束  
请根据此 Prompt 生成整套代码项目。
