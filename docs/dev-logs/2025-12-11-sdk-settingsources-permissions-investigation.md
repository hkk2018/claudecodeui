---
title: "Claude Agent SDK settingSources 權限機制調查"
description: "調查 SDK settingSources 參數實際載入的內容，確認是否包含 permissions 設定"
last_modified: "2025-12-11 01:54"
tags: ["sdk", "permissions", "investigation"]
---

# Claude Agent SDK settingSources 權限機制調查

## 調查背景

開發過程中發現：使用 Claude Code UI 專案時，同樣的操作在本機 CLI 不需要權限確認，但透過 SDK 呼叫卻需要。需要調查 SDK 的 `settingSources` 參數到底載入什麼內容。

## 問題描述

- **現象**：本機 CLI 使用時，工具權限從 `~/.claude/settings.json` 自動讀取
- **問題**：SDK 呼叫時即使設定 `settingSources: ['user', 'project', 'local']`，仍不確定是否會載入權限設定
- **疑問**：`settingSources` 只載入 CLAUDE.md？還是也包含 settings.json 的 permissions？

## 調查方法

直接閱讀 SDK 原始碼：
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`
- `node_modules/@anthropic-ai/claude-agent-sdk/cli.js`

## 調查結果

### 1. SDK 參數傳遞機制

**sdk.mjs:6450-6451**
```javascript
if (settingSources) {
  args.push("--setting-sources", settingSources.join(","));
}
```

SDK 將 `settingSources` 陣列轉換為 CLI 參數 `--setting-sources`。

### 2. CLI 處理 `--setting-sources`

**cli.js:3733-3734**
```javascript
function Wd6(A) {
  try {
    let B = dw0(A);  // 解析 "user,project,local"
    G20(B);          // 設定 allowedSettingSources
    Y4A();           // 載入設定
  } catch...
}
```

### 3. 來源名稱轉換

**cli.js - dw0 函數**
```javascript
function dw0(A) {
  if (A === "") return [];
  let B = A.split(",").map((I) => I.trim()), Q = [];
  for (let I of B)
    switch (I) {
      case "user": Q.push("userSettings"); break;
      case "project": Q.push("projectSettings"); break;
      case "local": Q.push("localSettings"); break;
      default: throw Error(`Invalid setting source: ${I}`);
    }
  return Q;
}
```

### 4. 預設設定來源

**cli.js - 初始化**
```javascript
allowedSettingSources: [
  "userSettings",
  "projectSettings",
  "localSettings",
  "flagSettings",
  "policySettings"
]
```

## 設定檔來源對照表

| settingSources 值 | 內部名稱 | 檔案位置 | 載入內容 |
|------------------|----------|---------|---------|
| `'user'` | userSettings | `~/.claude/settings.json` | **全部**（permissions, hooks, etc） |
| `'project'` | projectSettings | `.claude/settings.json` | **全部** |
| `'local'` | localSettings | `.claude/settings.local.json` | **全部** |

## 核心結論

**`settingSources` 會載入完整的 settings.json 內容，包含 permissions 設定。**

- `settingSources: ['user']` → 載入 `~/.claude/settings.json` 的所有設定
- `settingSources: ['project']` → 載入 `.claude/settings.json` 的所有設定
- `settingSources: ['local']` → 載入 `.claude/settings.local.json` 的所有設定

並非只載入 CLAUDE.md，而是完整的設定系統。

## 權限仍然需要確認的可能原因

如果設定了 `settingSources` 但還是會跳出權限請求，可能是：

1. **未設定 settingSources**
   - SDK 預設 `settingSources: []`（空陣列）
   - 不會載入任何 settings.json

2. **程式碼參數覆蓋**
   - SDK options 中的 `allowedTools` 參數會覆蓋設定檔
   - 優先順序：程式碼參數 > settings.json

3. **缺少 canUseTool callback**
   - 如果工具不在 `allowedTools` 列表中
   - SDK 需要 `canUseTool` callback 來處理互動式權限請求
   - 未實作此 callback 時會直接拋錯

## 相關檔案

- SDK 原始碼: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`
- CLI 原始碼: `node_modules/@anthropic-ai/claude-agent-sdk/cli.js`
- 使用者全域設定: `~/.claude/settings.json`
- 專案設定: `.claude/settings.json`
- 本地設定: `.claude/settings.local.json`

## 後續行動

本專案 (`claudecodeui`) 的 SDK 整合已正確設定：

```javascript
// server/claude-sdk.js:89-90
sdkOptions.settingSources = ['project', 'user', 'local'];
```

未來如果需要調整權限行為，應該：
1. 優先使用 settings.json 的 permissions 設定
2. 或實作 `canUseTool` callback 處理動態權限請求
3. 避免在程式碼中硬編碼 `allowedTools`（會覆蓋設定檔）
