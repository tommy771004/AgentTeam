# P0 fix: MCP secret ownership

## final result: **pass**

### Root cause
`syncPluginMcpServers` forced `pluginId: packageId`, wiping installer `pluginId: connectorId`, so enrich looked up the wrong secret.

### Fix
| Field | Meaning |
|-------|---------|
| `pluginId` | Package ownership (`github-mcp`) |
| `secretPluginId` | Token ownership (`github-connector`) |

- Installer writes both  
- `normalizePluginMcpServer` preserves `secretPluginId` on install/import/sync  
- `resolveMcpSecretOwnerId` prefers `secretPluginId`  
- Health/uninstall no longer require `pluginId === package id`  
- Fail-fast: custom tools + MCP call when secret missing  

### Regression
e2e: after sync-like shape (`pluginId=github-mcp`, `secretPluginId=github-connector`) env is filled from `github-connector` secret.

---

# SubDesign Open Design entry-view QA — 2026-07-13

- Source visual truth: `/Users/sha/Desktop/截圖 2026-07-13 上午10.45.12.png`
- Implementation screenshot: `/private/tmp/subdesign-entry-1440.png`
- Full-view comparison evidence: `/private/tmp/subdesign-entry-comparison.png`
- Viewport: 1440 × 960 desktop, `#/subdesign`, empty initial brief.
- Primary interactions tested: selecting「即時看板」範本同步更新建立表單；以該選項建立 brief 後，Plan thread 正確顯示「目標產物：資料儀表板」。範本、平台與 Design system 皆為可操作的原生選項。
- Console / overlay check: `HAS_CONTENT`，沒有 Vite error overlay。

## Full-view and focused comparison

參考圖的核心是置中問題、單一大型 composer、composer 下方輕量設定，以及橫向的起始範本列。實作保留這個 hierarchy：標題與輸入框成為唯一焦點，所有必要設定放在 composer 的底部或下一行，四張範本卡位於同一個視覺節奏中。SubAgents 的全域 sidebar 與 top chrome 是宿主產品的必要導覽，因此沒有仿製 Open Design 的右上工具列；主內容改用既有深藍玻璃表面與 cyan primary，而非來源的暖黑／橘色品牌。

## Fidelity surfaces

- **Fonts and typography:** 使用既有 Sora/Inter 系統；主問句採大字級，控制項與範本說明維持 12–14px 可讀性。
- **Spacing and layout rhythm:** 內容中心最大寬度 820px；composer、設定列、範本列依來源的垂直順序排列，沒有巢狀 sidebar 或工作區分頁干擾初始流程。
- **Colors and visual tokens:** 全面沿用 SubAgents 的 `background`、surface、outline 與 cyan `primary` token；無暖白背景或橘色 action。
- **Image quality and asset fidelity:** 來源為 controls-first UI；沿用產品既有 Material icon 元件作為可存取的互動 icon，未引入替代圖片或 CSS 繪圖。
- **Copy and content:** 將來源的泛用「設計」語彙映射至實際 SubDesign surface：產品原型、即時看板、Design System、簡報與報告。

## Findings and comparison history

1. [P1, fixed] 前一版使用一般工作區 header 與流程 rail，初始畫面沒有 Open Design 入口的單一焦點。現在改為置中提問與大型 composer。
2. [P1, fixed] 前一版的設定與說明分散於多個區塊。現在僅保留 surface、platform、Design system 與一個主 CTA。
3. [P2, fixed] 前一版的 artifact 工作區會搶走初始頁注意力。現在只在確實存在 artifact 時才於近期設計下方展開。

沒有可處理的 P0/P1/P2 視覺差異；宿主 sidebar/top chrome 是明確且可接受的產品整合差異。

## Implementation checklist

- [x] 置中提問與大型 brief composer。
- [x] 範本、平台、Design system 與建立 action 均可操作。
- [x] 起始範本卡同步表單選擇。
- [x] 1440 × 960 實機瀏覽器畫面、範本互動與錯誤覆蓋層完成檢查。

## Follow-up polish

- [P3] 有 project root 時，可將目前的「尚未選擇工作目錄」文字改為可開啟的 project picker；此行為屬全域 Project context，未在本次初始頁複製一套選擇器。

## Template categories — 2026-07-13

- Added the Open Design category rail: 全部 288、原型 82、即時產物 5、簡報 80、圖像 46、影片 49、HyperFrames 25、音訊 1.
- Ready template choices map to existing SubDesign surfaces and persist `templateId` into the brief and runtime prompt. Media cards are intentionally disabled until their matching capability is available.
- Browser evidence: `/private/tmp/subdesign-template-categories-1440.png` at 1440 × 960. Verified switching to「即時產物」filters to five cards; selecting「Flow 資料看板」sets the brief and output surface; 「圖像」entries expose a disabled, explicit「尚未啟用」state.
- Vendored upstream source, prompts, preview assets, and license notices under `app/public/open-design/` (1,336 files, about 57 MB).

final result: passed
