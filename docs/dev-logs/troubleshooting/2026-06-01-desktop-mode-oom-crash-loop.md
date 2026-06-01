---
title: "Desktop mode tab 消失 / focus 失效 — 真因是 server OOM crash loop"
description: "排查桌面模式 IDE tab 無故變少、focus 失效；最終定位為讀取超大 session JSONL 導致 node 反覆 OOM 重啟"
last_modified: "2026-06-01 05:18"
---

# 症狀

桌面模式（DesktopPanel）上方那排 IDE tab，本來 6–8 個，會**忽然掉到 5 個以內**，且「實際上沒有任何 IDE 視窗被關掉」；同一時間**focus 功能失效**（點了沒反應 / 回報失敗）。過幾秒、再 refresh 一次，又恢復成真正開著的多個視窗。整個現象間歇發生，最近變得很頻繁。

# 調查手法（含一次走錯方向的修正）

排查分兩階段，第一階段的結論是錯的，值得記錄為何會被誤導、以及怎麼被推翻。

## 階段一：誤判為視窗列舉不穩（走錯）

tab 與 focus 都由 `server/routes/overlay.ts` 用 `xdotool` 即時列舉 X11 視窗驅動，兩者共用同一套列舉邏輯——這條線索很自然地把注意力導向「列舉本身不穩」。當時的假設是：舊實作對每個視窗序列 spawn `xdotool getwindowname`、每個只給 1s timeout，逾時就 `catch{continue}` 靜默丟掉，因此在系統忙時會回傳殘缺清單。

**推翻的關鍵是實測**：在當下負載（load 1.2 / 16 核）連跑列舉，結果**穩定 8/8**，甚至 12 個並發同時打也全部 8/8，標題不跳、`getwindowname` 不逾時。換句話說，「列舉不穩」在現場重現不出來。這代表觸發點不在列舉，而在別處——也提醒：**用「系統很忙」當root cause 前，必須先用數據確認當下真的忙、且該機制真的會在該負載下失效**，否則只是看似合理的故事。

（這一階段仍順手把 overlay 改用單一 `wmctrl -lx`、補了 injection 防護——是有價值的韌性強化，但**不是**本 bug 的解，見 commit `bc459ce`。）

## 階段二：看 service log，定位 OOM crash loop（命中）

既然現場列舉是好的，就回到「為什麼 tab 會抓不到」最樸素的可能——**API 當下根本沒回應**。查 `journalctl -u claude-code-ui-dev`：

```
00:34:59  PID 2854617  FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
00:35:28  PID 2857859  FATAL ERROR: ... heap out of memory     ← 29 秒後又崩
00:35:38  PID 2859256  剛重啟，記憶體才 52.6M
```

`grep -c "heap out of memory"` 顯示**今天崩了 13 次**。`Restart=always` 把它一直拉起來，於是形成 crash loop：每次崩潰→重啟（數秒）→這段空窗期所有 `/api/overlay/ide-projects`、`/api/projects/.../sessions` 全部失敗→前端拿到空清單、tab 變少、focus 失效→服務回來+refresh 又正常。**與症狀完全吻合，且與視窗列舉無關。**

OOM 的 native stack 指向 `NewStringFromUtf8 → StringDecoder::DecodeData`——典型的「把一大塊 UTF-8 解碼/累積成 JS 字串或物件」。前面又反覆出現 `Error reading sessions for project ...`，於是去量 session 檔大小：

```
find ~/.claude/projects -type f -printf '%s\t%p\n' | sort -rn | head
575.9 MB  .../-home-ubuntu-Projects-ken-onexas/f5b258fe-...jsonl
324.9 MB  .../onexas/991464a1-...jsonl
226.2 MB  .../hpc-frontend/0b486fa4-...jsonl
...（projects 總計 2.5G，onexas 單一專案 1.6G）
```

對照讀取程式碼即確認根因（下節）。

# OOM 觸發機制

## 觸發鏈

1. DesktopPanel 開著時，每 **30 秒** poll 一次，對**所有專案**呼叫 `api.sessions(name,1,0)`（要最新 1 個 session）和 `api.sessionMessages(name,id,30,0)`（要最後 30 則訊息）。
2. onexas 有正在被 AI PM loop 持續寫入的 **575 MB** session JSONL。
3. server 端兩個讀取函式雖然用 `createReadStream`/`readline` 串流逐行讀，**卻把整個檔案的內容累積在記憶體裡，最後才做分頁切片**——等於串流的省記憶體優點被抵銷：

   - `getSessionMessages`（`server/projects.ts:1014`）：逐行 `JSON.parse` 後**全部 `messages.push(entry)`**（line 1040），讀完才 `sort` + `slice` 取尾端 30 筆（line 1085–1100）。要 30 筆，卻先把 575MB 全 parse 成物件堆在陣列。
   - `getSessions`（`:726`）→ `parseJsonlSessions`（`:854`）：逐行 `entries.push(entry)`（line 870），把**整檔所有 entry** 收進陣列回傳給 caller。per-session 的統計（summary、lastMessage、messageCount、lastActivity）其實是邊讀邊算、**不依賴這個 entries 陣列**；entries 只被 caller 用於 first-user-message 分組（只需 `type==='user' && parentUuid===null` 的少數 entry），以及一個**從未被讀取的 dead code** `uuidToSessionMap`（`:751/:775`）。
4. 575MB 文字 `JSON.parse` 成 JS 物件後在 heap 會膨脹數倍（單一 JSONL 行還可能內嵌數十 MB 的 tool result），輕易突破 1GB → V8 回報 `Reached heap limit` 致命 OOM → 進程死亡 → systemd 重啟 → 30 秒後 poll 再次觸發 → 無限循環。

## 為什麼「沒帶 limit」更糟

messages route（`server/index.ts:529`）在沒有 `limit` query 時 `parsedLimit=null`，`getSessionMessages` 會走「回傳全部」分支（line 1092），對大檔必爆。DesktopPanel 帶了 `limit=30` 走分頁分支，但因為「先全載入再切尾」，**一樣爆**。

## 與 systemd 資源限制的關係

dev service 設了 `MemoryMax=1G`（見 `.claude/CLAUDE.md` 資源限制章節）。這個限制**正確地把爆炸侷限在這個 service、沒有拖垮整台機器**（符合當初設計目的），但它無法阻止 service 自身 crash loop——要根治必須改讀取方式，不是調大記憶體（檔案只會越長越大，調大只是延後爆炸）。

# 推薦修法

核心原則：**永遠不要把整個 session 檔載入記憶體；記憶體用量要與「請求要的資料量」成正比，與「檔案大小」無關。**

## 修法 A — `getSessionMessages` 改用尾端 ring buffer（高優先、低風險）

分頁本來就只回尾端 `offset+limit` 筆。串流時只保留一個大小為 `offset+limit` 的滑動視窗（push 後超出就 shift），讀完直接是要的那段，不需要 `sort` 全集。JSONL 本身已按時間 append，尾端即最新。記憶體從「整檔」降到「數十筆」。

`limit===null`（完整對話）路徑仍是 API 合約上的全載入，屬於下一層問題：可加**單行/總量上限保護**或改為「只回最後 N 筆並標記 truncated」，但這不是 crash loop 的觸發點，可分開處理。

## 修法 B — `parseJsonlSessions` 不再收集整檔 entries（高優先、低風險）

只 `push` 真正需要的 entry（`type==='user' && parentUuid===null` 的 first-user-message），其餘不存；順手刪掉 dead code `uuidToSessionMap`。per-session 統計維持邊讀邊算不變。`getSessions` 的記憶體即與檔案大小脫鉤。

## 修法 C — 防範機制（架構層，避免再犯）

1. **大檔保護 / 告警**：讀取前 `fs.stat`，檔案超過閾值（如 100MB）時走純串流尾讀路徑，並 `log.warn` 記錄是哪個專案哪顆檔，讓問題可被觀測而非靜默 OOM。
2. **既有巨檔處置**：onexas / hpc-frontend 已累積 500MB+ 的 session 檔（多半來自長時間 AI PM loop）。修完讀取邏輯後 server 不會再爆，但這些檔仍會被讀；可評估歸檔或輪替策略（**屬破壞性操作，須先與使用者確認，不自行刪除**）。
3. **回歸測試**：用一顆人工產生的大檔（或指向 onexas 巨檔）對 `getSessions`/`getSessionMessages` 寫一個「記憶體上限內完成」的測試，把這個 OOM 釘死、避免未來改動回退。

## 不建議的做法

- ❌ 調大 `MemoryMax` 或 `--max-old-space-size`：檔案持續增長，只是延後爆炸，且會讓單一 service 有機會吃更多系統資源。
- ❌ 關閉 DesktopPanel 的 30s poll：那是症狀層，根因是讀取方式。

# 相關檔案與證據

- 讀取漏點：`server/projects.ts:1040`（getSessionMessages 全累積）、`:870`（parseJsonlSessions 全收集 entries）、dead code `:751/:775`
- route：`server/index.ts:520`（sessions）、`:537`（messages，null limit）
- 觸發端：`src/components/DesktopPanel.tsx:201`（30s poll）
- 階段一的韌性強化（非本 bug 解）：commit `bc459ce` overlay 改 `wmctrl -lx`
- log 證據：`journalctl -u claude-code-ui-dev`，今日 13 次 `heap out of memory`

# 後記：第一版修復不完整 + 真正完整的修法

第一版只 commit 了「不要把整檔放進陣列」（ring buffer + 不收集 entries，commit `c61f61e`）。當下用單發請求驗證通過（575MB 讀取降到 70MB），但**部署後仍 OOM 32 次**，且型態變成「跑幾分鐘、heap 緩慢爬到 ~448MB 才爆」。

## 為什麼第一版不夠

漏看了兩件事：

1. **真正的記憶體尖峰不是「陣列累積」，是「串流時把單一巨大行 materialize 成一個 JS 字串」。** 那顆 session 內嵌數十 MB 的 tool result，`readline`/`StringDecoder` 必須把整行（數十 MB）變成一個字串（UTF-16 再 ×2）。即使陣列已 bound，只要**還在逐行串流整個大檔**，碰到巨大行就瞬間吃掉上百 MB，疊在基線上撞破 1G cgroup。OOM stack 一直是 `StringDecoder::DecodeData → NewFromUtf8` 正是此意。
2. **大檔被「整檔讀」的路徑不只一條，且都在 30 秒 poll 裡**：`getSessions`（透過 `parseJsonlSessions` 串流整檔算 metadata）**和** `getSessionMessages(limit=30)`（DesktopPanel 對每個專案最新 session 都呼叫）。只修 `getSessionMessages` 的陣列、沒改「整檔串流」本身，也沒碰 `getSessions`，所以 poll 一輪仍會把 575MB 讀兩遍。

教訓：**bound 住「終點容器」不等於 bound 住「過程峰值」。** 只要還會把整個大檔餵進解碼器，單行尖峰就足以 OOM；根治要從「根本不讀整檔」下手。

## 完整修法（已實作並驗證）

核心：**大檔（>5MB）一律只讀 head/tail，絕不整檔串流。**

- `getSessions` → `readLargeSessionMeta`（commit `4b4fbd2`）：只讀檔頭（first-user-message 供 grouping + cwd + 顯式 summary）+ 檔尾（最後 user/assistant 訊息 + lastActivity），messageCount 由檔案大小估算。小檔仍走原 `parseJsonlSessions` 精確路徑。回傳同 `{sessions, entries}` 形狀，grouping/過濾/分頁不變。
- `getSessionMessages` → `readSessionMessagesTail`（commit `a252bc4`）：分頁讀大檔時，從檔尾讀一段（512KB 起、×4 成長到上限 32MB）直到湊滿 `offset+limit` 筆或讀到檔頭，再切片。`total` 在整檔讀進時為精確值、否則用密度估算；`hasMore` 由「是否讀到檔頭」決定。超過 32MB 尾段才需要的深分頁，退回 bounded stream。

## 驗證結果

| 指標 | 修復前 | 完整修復後 |
|------|--------|-----------|
| onexas `sessions?limit=1`（575MB 檔）| 4.7s | 0.074s |
| onexas `messages?limit=30`（208k 則）| 2.7s | 0.084s |
| dev service CPU | 29.6%（榜首）| 3.8% |
| 記憶體（有 client poll）| 爬到 ~448MB 撞 1G 爆 | ~79MB |
| OOM | 今日 50 次 / crash loop | 重啟後 0 |

小檔專案（claudecodeui）的 summary 與精確 messageCount 不變，無回歸。

## 已知殘留 / 後續

- **估算值偏差**：messageCount badge 與大檔 messages 的 `total` 都是估算，目前一個偏高（用檔頭密度）、一個偏低（用檔尾密度），純顯示用、不影響功能。若要一致可改成 head+tail 雙取樣平均。
- **cgroup 1G 不需調大**：拿掉大檔全讀後，含 poll 的實際用量 ~79MB，1G 非常寬裕。
- 巨檔（onexas 575MB 等）本身不刪除（使用者明確要求保留），由本次讀取優化承載。
