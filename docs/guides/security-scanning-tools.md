---
title: "Security Scanning Tools 安全掃描工具介紹"
description: "本專案導入的安全掃描工具說明與使用指南"
last_modified: "2025-12-12 19:09"
---

# Security Scanning Tools 安全掃描工具介紹

本專案透過 GitHub Actions 整合了多種安全掃描工具，分為**阻擋層（🔴）**和**警告層（🟡）**兩類。

## 工具分類架構

```
🔴 阻擋層 (Blocking)     → 失敗會阻擋 PR merge
├── TruffleHog          → 敏感資訊洩漏檢測
└── npm audit (critical) → 嚴重漏洞檢測

🟡 警告層 (Warning)      → 失敗僅顯示警告，不阻擋
├── CodeQL              → 靜態程式碼分析
├── npm audit (full)    → 完整依賴漏洞掃描
├── ESLint Security     → 安全性程式碼規則檢查
└── OSV Scanner         → 開源漏洞資料庫掃描

🔧 自動維護工具
└── Dependabot          → 自動依賴更新與安全性修補
```

---

## 🔴 阻擋層工具 (Blocking Checks)

### 1. TruffleHog - 敏感資訊洩漏檢測

**用途**：掃描程式碼中的敏感資訊（API Keys、密碼、Token 等）

**檢測內容**：
- API Keys (AWS, GCP, Azure, etc.)
- Private Keys (SSH, GPG, SSL)
- Database Credentials
- OAuth Tokens
- JWT Secrets
- 其他已知的敏感資訊模式

**運作方式**：
- **PR 模式**：只掃描 PR 的變更部分（`base` vs `head`）
- **Push/Schedule 模式**：掃描整個儲存庫
- **驗證機制**：`--only-verified` 只回報已驗證的真實 secrets

**何時觸發**：
```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 9 * * 1'  # 每週一早上 9 點
```

**阻擋規則**：
- ✅ 未發現 secrets → 通過
- ❌ 發現已驗證的 secrets → **阻擋 PR merge**

**如何修復**：
1. 從程式碼中移除硬編碼的 secrets
2. 改用環境變數或 GitHub Secrets
3. 使用 `.env` 檔案（並加入 `.gitignore`）

---

### 2. npm audit (Critical) - 嚴重漏洞檢測

**用途**：檢查依賴套件中的 **critical** 等級安全漏洞

**檢測範圍**：
- 直接依賴（`dependencies`）
- 開發依賴（`devDependencies`）
- 傳遞依賴（dependencies of dependencies）

**漏洞等級**：
```
只檢查: critical (最嚴重)
忽略: high, moderate, low
```

**運作方式**：
```bash
npm audit --audit-level=critical
```
- 掃描 `package-lock.json` 中的所有依賴
- 與 npm 官方漏洞資料庫比對
- 發現 critical 漏洞時立即失敗

**阻擋規則**：
- ✅ 無 critical 漏洞 → 通過
- ❌ 有 critical 漏洞 → **阻擋 PR merge**

**如何修復**：
1. 執行 `npm audit fix` 自動修復
2. 或手動更新有問題的套件：`npm update <package-name>`
3. 若無法修復，考慮替換套件或尋找 patch 方案

---

## 🟡 警告層工具 (Warning Checks)

### 3. CodeQL - 靜態程式碼分析

**用途**：深度靜態分析，找出程式碼中的安全漏洞與潛在問題

**檢測內容**：
- SQL Injection
- Cross-Site Scripting (XSS)
- Path Traversal
- Command Injection
- Insecure Cryptography
- Hardcoded Credentials
- Resource Leaks
- Logic Errors

**支援語言**：
- JavaScript / TypeScript (本專案使用)
- Python, Java, C/C++, C#, Ruby, Go, Swift, Kotlin 等

**查詢模式**：
```yaml
queries: security-extended
```
- **security-extended**：包含所有安全性相關的查詢規則
- 比預設模式更嚴格，涵蓋更多潛在問題

**結果查看**：
- GitHub → Security tab → Code scanning alerts
- 會標註程式碼位置、嚴重性、建議修復方式

**特點**：
- 不阻擋 PR merge，僅顯示警告
- 結果會持續累積在 Security Dashboard
- 可設定自動修復建議（Dependabot 整合）

---

### 4. npm audit (Full) - 完整依賴漏洞掃描

**用途**：全面檢查所有等級的依賴漏洞

**檢測等級**：
```
✅ critical   (最嚴重)
✅ high       (高危)
✅ moderate   (中危)
✅ low        (低危)
```

**運作方式**：
```bash
npm audit --audit-level=low || true
```
- 檢查所有等級的漏洞
- 產生 JSON 格式報告
- 上傳至 GitHub Artifacts（保留 30 天）

**報告內容**：
- 漏洞 CVE 編號
- 影響的套件與版本
- 嚴重性等級
- 修復建議
- 相依路徑（哪個套件引入的）

**如何查看報告**：
1. GitHub Actions → 點選 workflow run
2. Artifacts → 下載 `npm-audit-report.json`
3. 或在 Summary 頁面查看統計數據

**特點**：
- `|| true` 確保不會失敗
- 提供完整的漏洞清單供參考
- 不阻擋 PR，但建議定期處理

---

### 5. ESLint Security - 安全性程式碼規則檢查

**用途**：用程式碼規則檢查常見的安全問題與不良實踐

**使用的插件**：

#### **eslint-plugin-security**
檢測常見的 Node.js 安全問題：

| 規則 | 說明 | 等級 |
|------|------|------|
| `detect-buffer-noassert` | 檢測不安全的 Buffer 操作 | error |
| `detect-child-process` | 檢測 child_process 使用（可能有注入風險） | warn |
| `detect-eval-with-expression` | 檢測 eval() 使用 | error |
| `detect-no-csrf-before-method-override` | CSRF 保護檢查 | error |
| `detect-non-literal-fs-filename` | 檢測動態檔案路徑（Path Traversal 風險） | warn |
| `detect-non-literal-regexp` | 檢測動態正則表達式（ReDoS 風險） | warn |
| `detect-non-literal-require` | 檢測動態 require | warn |
| `detect-object-injection` | 檢測物件注入風險 | warn |
| `detect-possible-timing-attacks` | 檢測可能的時序攻擊 | warn |
| `detect-pseudoRandomBytes` | 檢測不安全的隨機數產生 | error |
| `detect-unsafe-regex` | 檢測不安全的正則表達式 | error |

#### **eslint-plugin-no-secrets**
檢測硬編碼的敏感資訊：

```javascript
'no-secrets/no-secrets': ['error', { tolerance: 4.5 }]
```
- 使用熵值分析（entropy analysis）
- `tolerance: 4.5` = 敏感度閾值
- 可檢測：API Keys, Tokens, Passwords, Private Keys

**掃描範圍**：
```
src/       → 前端程式碼
server/    → 後端程式碼
```

**報告格式**：
- JSON 格式輸出
- 上傳至 GitHub Artifacts
- 顯示檔案路徑、行號、錯誤訊息

**如何修復**：
1. 根據報告的檔案與行號找到問題程式碼
2. 依據規則建議修改
3. 或在特定行加上 `// eslint-disable-next-line <rule-name>`（需有充分理由）

---

### 6. OSV Scanner - 開源漏洞資料庫掃描

**用途**：掃描 Google 維護的開源漏洞資料庫（OSV - Open Source Vulnerabilities）

**資料來源**：
- [osv.dev](https://osv.dev/) - Google 的開源漏洞資料庫
- 整合多個來源：
  - npm 官方漏洞資料庫
  - GitHub Advisory Database
  - Python PyPI
  - RubyGems
  - Go
  - Rust Crates
  - 等等...

**掃描方式**：
```bash
osv-scanner --lockfile=package-lock.json --format=table
```
- 分析 `package-lock.json` 中的所有依賴
- 與 OSV 資料庫比對
- 以表格格式輸出結果

**輸出範例**：
```
╭─────────────┬──────────┬───────────────────┬──────────╮
│ Package     │ Version  │ Vulnerability ID  │ Severity │
├─────────────┼──────────┼───────────────────┼──────────┤
│ express     │ 4.17.1   │ GHSA-qw6h-vgh9... │ HIGH     │
│ lodash      │ 4.17.15  │ CVE-2020-8203     │ MEDIUM   │
╰─────────────┴──────────┴───────────────────┴──────────╯
```

**特點**：
- 資料庫更新頻繁，可能比 npm audit 更即時
- 涵蓋範圍更廣（跨語言、跨生態系）
- 提供詳細的漏洞資訊連結

**與 npm audit 的差異**：
| 特性 | npm audit | OSV Scanner |
|------|-----------|-------------|
| 資料來源 | npm 官方 | Google OSV (多來源整合) |
| 更新速度 | 中等 | 較快 |
| 語言支援 | 僅 JavaScript/Node.js | 多語言 |
| 詳細度 | 中等 | 高（提供更多參考資料） |

**使用建議**：
- 與 npm audit 互補使用
- 定期查看掃描結果
- 優先處理 HIGH/CRITICAL 漏洞

---

## 🔧 自動維護工具

### 7. Dependabot - 自動依賴更新與安全性修補

**用途**：自動偵測過時的依賴並建立更新 PR

**配置位置**：`.github/dependabot.yml`

**監控範圍**：

#### **npm 依賴**
```yaml
package-ecosystem: "npm"
schedule:
  interval: "weekly"
  day: "monday"
  time: "09:00"
  timezone: "Asia/Taipei"
```

**更新策略**：
- **自動分組**：減少 PR 數量
  - `production-dependencies`：生產依賴的 minor/patch 更新
  - `development-dependencies`：開發依賴的 minor/patch 更新
- **忽略 major 更新**：主版本更新需手動處理（避免 breaking changes）
- **PR 數量限制**：最多同時開 10 個 PR

**Commit Message 格式**：
```
chore(deps): update production-dependencies
chore(deps): update development-dependencies
```

#### **GitHub Actions**
```yaml
package-ecosystem: "github-actions"
schedule:
  interval: "weekly"
```

**更新內容**：
- workflow 中使用的 Actions（如 `actions/checkout@v4`）
- 確保使用最新、最安全的版本

**PR 標籤**：
- `dependencies` - 所有依賴更新
- `security` - 包含安全性修補
- `github-actions` - GitHub Actions 更新

**如何處理 Dependabot PR**：
1. **安全性更新**（標記 `security`）：
   - 優先處理
   - 查看 CVE 詳情
   - 測試後盡快 merge
2. **一般更新**：
   - 查看 changelog 確認變更
   - 執行測試確保相容性
   - 可定期批次處理
3. **主版本更新**（需手動處理）：
   - 詳細閱讀 migration guide
   - 執行完整測試
   - 可能需要修改程式碼

**優點**：
- 減少手動維護工作
- 及時獲得安全性修補
- 保持依賴版本新鮮
- 自動化測試整合（透過 CI）

---

## 執行時機總覽

```yaml
觸發條件:
  push:
    branches: [main]           # Push 到 main 時執行
  pull_request:
    branches: [main]           # PR 到 main 時執行
  schedule:
    - cron: '0 9 * * 1'        # 每週一早上 9:00 (UTC) 執行
```

**時區換算**：
- UTC 9:00 = 台北時間 17:00 (夏令時) 或 18:00 (標準時)

**建議執行頻率**：
- **PR 時必跑**：確保新程式碼不引入安全問題
- **週期性掃描**：發現依賴套件的新漏洞
- **Push 到 main**：雙重保險（雖然 PR 已檢查）

---

## 查看掃描結果

### 1. GitHub Actions Workflow
```
Repository → Actions → Security Scan workflow → 查看各 job 結果
```

### 2. Security Dashboard
```
Repository → Security → Code scanning alerts
```
- CodeQL 的結果會出現在這裡
- 可以查看歷史記錄、趨勢圖

### 3. Artifacts
```
Workflow run → Artifacts
```
- `npm-audit-report.json` - npm audit 完整報告
- `eslint-security-report.json` - ESLint 安全掃描報告

### 4. Summary 摘要
每次執行都會產生 **Security Summary**：

```markdown
## 🔒 Security Scan Summary

### 🔴 Blocking Checks (Must Pass)
| Check                          | Status        |
|--------------------------------|---------------|
| Secrets Detection              | ✅ Passed     |
| NPM Critical Vulnerabilities   | ✅ Passed     |

### 🟡 Warning Checks (Informational)
| Check           | Status    |
|-----------------|-----------|
| CodeQL Analysis | success   |
| NPM Audit (All) | success   |
| ESLint Security | success   |
| OSV Scanner     | success   |
```

---

## 常見問題與解決方案

### Q1: TruffleHog 誤報怎麼辦？
**A**: 如果是測試用的假 key，可以：
1. 確認是否真的是假的（不要把真 key 當假的！）
2. 移至 `.env.example` 並標註為範例
3. 使用註解說明：`// Example key for testing only`

### Q2: npm audit 發現漏洞但無法更新怎麼辦？
**A**: 常見原因：
1. **傳遞依賴問題**：
   ```bash
   npm audit fix --force  # 強制更新（可能有 breaking changes）
   ```
2. **套件作者尚未修復**：
   - 查看該套件的 issue tracker
   - 考慮替換套件
   - 或使用 `npm audit fix --package-lock-only` 暫時修復 lock file
3. **使用 overrides（npm 8.3+）**：
   ```json
   {
     "overrides": {
       "vulnerable-package": "^safe-version"
     }
   }
   ```

### Q3: CodeQL 報告太多 warning 怎麼辦？
**A**: CodeQL 很嚴格，建議：
1. **優先處理高嚴重性**（High/Critical）
2. **分批處理**：一次處理一個類別的問題
3. **確認誤報**：可在 Security tab 標記為 false positive
4. **學習機會**：CodeQL 的建議通常很有價值

### Q4: ESLint Security 的 `detect-object-injection` 誤報？
**A**: 這是常見的誤報規則，如果確定安全：
```javascript
// eslint-disable-next-line security/detect-object-injection
const value = obj[key];
```
或改用更安全的寫法：
```javascript
const value = Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
```

### Q5: Dependabot PR 太多怎麼辦？
**A**: 已透過 `groups` 配置減少 PR 數量：
- 生產依賴會合併成一個 PR
- 開發依賴會合併成另一個 PR
- 可調整 `open-pull-requests-limit` 控制數量

---

## 最佳實踐建議

### 1. **定期檢視安全警告**
- 每週至少檢查一次 Security Dashboard
- 優先處理 Critical/High 等級問題
- 建立處理 SLA（例如：Critical 24h 內處理）

### 2. **不要忽略警告**
- Warning 層工具雖不阻擋，但問題仍需關注
- 累積太多警告會成為技術債
- 定期安排時間處理積壓問題

### 3. **保持依賴更新**
- 及時 merge Dependabot 的安全性更新
- 定期升級依賴（不要等到太舊才升級）
- 使用 `npm outdated` 檢查過時的套件

### 4. **整合到開發流程**
- 本地開發時執行 `npm audit`
- Commit 前執行 ESLint security 檢查
- PR review 時檢查安全掃描結果

### 5. **文檔化例外情況**
- 如果必須忽略某個警告，要記錄原因
- 使用 issue 追蹤待處理的安全問題
- 定期 review 例外清單

### 6. **教育團隊**
- 分享安全掃描工具的發現
- 討論常見的安全問題模式
- 建立安全編碼規範

---

## 相關資源

### 官方文檔
- [TruffleHog](https://github.com/trufflesecurity/trufflehog)
- [CodeQL](https://codeql.github.com/docs/)
- [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit)
- [ESLint Security Plugin](https://github.com/eslint-community/eslint-plugin-security)
- [OSV Scanner](https://google.github.io/osv-scanner/)
- [Dependabot](https://docs.github.com/en/code-security/dependabot)

### 漏洞資料庫
- [npm Advisory Database](https://www.npmjs.com/advisories)
- [GitHub Advisory Database](https://github.com/advisories)
- [OSV - Open Source Vulnerabilities](https://osv.dev/)
- [CVE - Common Vulnerabilities and Exposures](https://cve.mitre.org/)

### 安全性指南
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security/getting-started/github-security-features)

---

## 總結

本專案的安全掃描架構採用**多層防禦**策略：

```
🔴 第一道防線: 阻擋明確的安全威脅
   ├── 敏感資訊洩漏 (TruffleHog)
   └── 嚴重漏洞 (npm audit critical)

🟡 第二道防線: 發現潛在問題
   ├── 程式碼安全問題 (CodeQL, ESLint)
   └── 依賴漏洞 (npm audit full, OSV)

🔧 持續維護: 自動化更新
   └── 依賴更新與安全修補 (Dependabot)
```

**核心理念**：
- **自動化**：減少人工檢查負擔
- **多工具互補**：不同工具有不同優勢
- **分層策略**：critical 問題阻擋，其他問題警告
- **持續改進**：定期掃描 + 自動更新

透過這些工具的組合使用，可以大幅降低安全風險，並建立持續的安全維護機制。
