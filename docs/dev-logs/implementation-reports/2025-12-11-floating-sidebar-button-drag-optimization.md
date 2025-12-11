---
title: "Floating Sidebar Button - Drag Performance Optimization"
description: "移動端浮動按鈕拖曳效能優化，從「追趕」到「完全跟隨」"
last_modified: "2025-12-11 08:55"
---

# Floating Sidebar Button - Drag Performance Optimization

## 問題描述

實作移動端浮動側邊欄按鈕的拖曳功能時，遇到嚴重的延遲問題：

### 初始症狀
- 拖動時按鈕移動非常慢
- 按鈕無法跟隨手指，呈現「追趕」效果
- 拖動過程中幾乎沒有移動，放手後突然跳到目標位置
- 使用者體驗極差

### 使用者回饋
> "還是會有一點頓頓的"
> "前面拖的時候變慢他最後一刻突然快速的靠近目標"

## 根本原因分析

### 1. CSS Transition 造成的延遲
```css
/* ❌ 錯誤：transition 一直作用 */
transition-all duration-200
```
- 每次位置更新都觸發 200ms 的平滑過渡
- 導致按鈕位置「追趕」手指位置
- 累積延遲造成明顯的拖曳不順

### 2. Backdrop Filter 渲染成本
```css
/* ❌ 錯誤：拖曳時仍保持 blur */
backdrop-filter: blur(8px);
```
- `blur(8px)` 是高成本的視覺效果
- 每次位置更新都需要重新計算模糊效果
- 在快速拖曳時嚴重拖累效能

### 3. React State 更新延遲
- 早期版本使用 `setPosition()` 更新每一幀
- 每次更新觸發 React 重新渲染
- 渲染週期造成額外延遲

## 解決方案

### 關鍵優化 1：條件性 Transition
```jsx
className={`... ${
  isDragging
    ? 'bg-blue-600/70 scale-110'
    : 'bg-blue-600/60 ... transition-all duration-200'
}`}
```
**效果**：拖曳時完全移除 transition，停止後才恢復平滑效果

### 關鍵優化 2：動態 Backdrop Filter
```jsx
style={{
  backdropFilter: isDragging ? 'none' : 'blur(8px)',
  WebkitBackdropFilter: isDragging ? 'none' : 'blur(8px)',
}}
```
**效果**：拖曳時關閉模糊效果，大幅降低渲染成本

### 關鍵優化 3：Will-Change 提示
```jsx
style={{
  willChange: isDragging ? 'left, top' : 'auto',
}}
```
**效果**：告訴瀏覽器即將改變 left/top，瀏覽器預先優化渲染層

### 關鍵優化 4：直接 DOM 操作
```javascript
const updateButtonPosition = (x, y) => {
  // 直接操作 DOM，不觸發 React 重新渲染
  buttonRef.current.style.left = `${boundedX}px`;
  buttonRef.current.style.top = `${boundedY}px`;

  // 只更新 ref，不更新 state
  dragState.current.currentX = boundedX;
  dragState.current.currentY = boundedY;
};
```
**效果**：避免 React 重新渲染延遲，即時更新位置

### 關鍵優化 5：拖曳結束後才保存
```javascript
const handleTouchEnd = (e) => {
  if (wasDragging) {
    // 拖曳結束後才更新 React state 和 localStorage
    setPosition({
      x: dragState.current.currentX,
      y: dragState.current.currentY
    });
  }
};
```
**效果**：減少拖曳過程中的 state 更新次數

## 效能改進結果

### Before（優化前）
- ❌ 拖曳延遲明顯
- ❌ 按鈕追趕手指位置
- ❌ 使用者體驗差

### After（優化後）
- ✅ **拖曳完全順暢**（使用者回饋："完全順了"）
- ✅ 按鈕即時跟隨手指
- ✅ 無延遲、無卡頓
- ✅ 接近原生應用體驗

## 技術要點總結

### 移動端拖曳最佳實踐
1. **拖曳時關閉 CSS transition**：避免平滑過渡造成延遲
2. **拖曳時關閉高成本視覺效果**：如 blur、shadow 等
3. **使用 `willChange` 提示**：讓瀏覽器預先優化
4. **直接操作 DOM**：避免框架重新渲染延遲
5. **減少拖曳中的 state 更新**：只在開始和結束時更新

### 效能優化原則
- **60 FPS 為目標**：每幀需在 16.67ms 內完成
- **減少重新渲染**：直接 DOM 操作比 React state 更新快
- **GPU 加速**：使用 `transform` 比 `left/top` 更快（但本案例中 `left/top` 配合其他優化已足夠）
- **條件性載入效果**：高成本視覺效果只在必要時啟用

## 相關檔案

- **元件**：`src/components/FloatingSidebarButton.jsx`
- **設定 UI**：`src/components/Settings.jsx` (line 850-878)
- **整合**：`src/App.jsx`, `src/components/MainContent.jsx`

## 學習心得

1. **CSS transition 不是免費的**：在需要高效能互動時必須謹慎使用
2. **視覺效果與效能的權衡**：backdrop-filter 雖美觀但成本高
3. **瀏覽器渲染優化提示很重要**：`willChange` 能顯著改善效能
4. **測量與迭代**：從使用者實際回饋找到效能瓶頸，逐步優化

## 後續可能改進

1. 考慮使用 `transform: translate()` 取代 `left/top`（GPU 加速）
2. 加入 `touch-action: none` 防止頁面滾動干擾
3. 使用 `requestAnimationFrame` 進一步優化更新時機（目前已足夠順暢）
