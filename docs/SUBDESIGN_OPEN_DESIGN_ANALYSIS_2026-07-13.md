# Open Design 原始碼 × SubDesign 比較分析

> 日期：2026-07-13  
> Open Design 分析版本：[`4567a0d`](https://github.com/nexu-io/open-design/tree/4567a0d57557b29eb79ef1f7a40826f2b801d982)  
> SubAgents AI 比對基準：目前工作分支 `20260712`（`63bfbb2`，已含 SubDesign）；並以 `main`（`d229388`）作為整合前基線  
> 結論：保留 SubAgents AI 作為唯一的 agent、權限與桌面執行核心；將 SubDesign 做成其中一個一致的「設計工作區」，不要搬入第二個 Open Design runtime 或其獨立 UI。

## 1. 本次查核範圍與重要發現

1. 已閱讀 Open Design monorepo 的 daemon、agent runtime、artifact manifest、design-system registry、web workspace 與 critique 邊界。
2. 已靜態比對 SubAgents AI 現行 `main` 及含 SubDesign 的 `origin/20260712`。
3. **目前工作分支已含 SubDesign 路由、頁面、store、capability 與 Electron export IPC。** 它相對 `main` 的整合前基線新增了這些能力，因此後續驗證與 UI 改造均以目前工作分支為準。
4. `origin/20260712` 已不只 Foundation：brief / direction gate、`DESIGN.md` 掃描、artifact manifest、sandbox preview、critique、HTML/ZIP/PDF export 都已有第一版程式碼。
5. 目前 SubDesign 的最大產品問題不是功能不足，而是它採用了另一套暖白 / 橘色的獨立產品視覺，與 SubAgents 的深色液態玻璃、青藍主色、Sora / Inter 字體系統及 light/dark 主題機制衝突。

`RTK.md` 被根目錄 `AGENTS.md` 引用，但目前工作區並不存在該檔案；本分析未能套用其未知內容。

## 2. Open Design：原始碼架構摘要

Open Design 是一個完整的本機優先設計產品，而不只是 prompt 或 UI 模板。其拆分方式很清楚：

| 層級 | 主要位置 | 責任 | 對 SubAgents 的判斷 |
|---|---|---|---|
| Desktop shell | `apps/desktop`、`apps/packaged` | Electron、sidecar、更新與桌面宿主 | 不導入；SubAgents 已有 Electron main/preload。 |
| Privileged daemon | `apps/daemon` | HTTP API、CLI adapters、artifact/project/design-system persistence、export | 不導入；避免和現有 IPC / agent engine 成為兩套執行生命週期。 |
| Web app | `apps/web` | Next/React workspace、composer、iframe preview、project shell | 不搬 UI；借鑑資訊架構與 artifact-first workflow。 |
| Shared contracts | `packages/contracts` | Zod/TypeScript API、artifact 與 project 合約 | 借鑑資料模型與驗證邊界，不必引入 workspace package。 |
| Plugin runtime | `packages/plugin-runtime` | plugin manifest、stage、validation、digest | 保留 SubAgents 既有 Hermes plugin/skill 系統，只做相容層。 |

Open Design 把使用者本機的 Codex、Claude、OpenCode 等 CLI 視為 design engine；例如其 Codex adapter 使用 `codex exec --json`、stdin prompt、stream event parser、上游 session resume 與受控 sandbox。這與 SubAgents 現有 `runDispatch.ts` / `localCliRun.ts` 的責任重疊，故不應再建立第二套 adapter registry。

參考：[`runtimes/defs/codex.ts`](https://github.com/nexu-io/open-design/blob/4567a0d57557b29eb79ef1f7a40826f2b801d982/apps/daemon/src/runtimes/defs/codex.ts)、[`artifacts/manifest.ts`](https://github.com/nexu-io/open-design/blob/4567a0d57557b29eb79ef1f7a40826f2b801d982/apps/daemon/src/artifacts/manifest.ts)、[`design-systems/index.ts`](https://github.com/nexu-io/open-design/blob/4567a0d57557b29eb79ef1f7a40826f2b801d982/apps/daemon/src/design-systems/index.ts)。

### 值得採用的四個核心概念

1. **Artifact-first**：輸出不是一段聊天文字，而是已驗證的 artifact manifest（kind、renderer、entry、supporting files、exports、revision）。
2. **`DESIGN.md` 是品牌契約**：設計系統、tokens、元件規則都能被人閱讀、被 agent 注入、被版本控制。
3. **明確設計迴圈**：discover brief → lock direction → build artifact → critique → deliver。
4. **不可信內容隔離**：HTML preview、外部 template、設計檔與網頁內容都不能取得宿主權限；manifest path 必須是 project-relative。

### 不應直接移植的內容

- Express daemon、SQLite、sidecar、20+ CLI adapter、Next.js workspace。
- 完整 media router、PPTX / MP4 pipeline 與上游 plugin pipeline。
- Open Design 的暖色 editor 視覺。

這些會造成雙重設定、雙重權限模型與雙重 session / export state；成本高，且不會提升 SubAgents 的核心差異化。

## 3. SubDesign 實作現況

### 3.1 分支狀態

| 範圍 | `main`（整合前基線） | 目前工作分支 `20260712` | 判定 |
|---|---:|---:|---|
| `/subdesign` route / 左側入口 | 無 | 有 | 已整合，待 UI 一致化與驗證 |
| Structured brief 與 stage | 無 | 有 | 已整合 |
| `DESIGN.md` registry | 無 | 有 | 已整合 |
| Artifact manifest / preview | 無 | 有 | 已整合 |
| Critique / export | 無 | 有 | 已整合，待端到端驗證 |

目前工作分支就是 `20260712`；若日後需要回合 `main` 或建立 PR，請注意它相對 `main` 也含一些與 SubDesign 無關的改動與刪除。建議在提交前將變更分成可驗證的小範圍 commit，避免把無關回歸混入 SubDesign 發布。

### 3.2 已實作功能（`origin/20260712`）

| Open Design 概念 | SubDesign 對應 | 成熟度 | 說明 |
|---|---|---|---|
| Brief | `subdesign/brief.ts`、`subDesignStore.ts` | 已有第一版 | 保存目標、受眾、平台、fidelity、限制、驗收條件與 direction。 |
| Direction lock | `design_direction_select`、`toolGuard.ts` | 已有第一版 | 未選 direction 時攔截 `workspace_write`、design-system 寫入與 export。 |
| Design system | `designSystem.ts`、`design_system_*` tools | 已有第一版 | 掃描 root `DESIGN.md` 與 `.subagents/subdesign/design-systems/*/DESIGN.md`。 |
| Artifact manifest | `artifactManifest.ts`、`design_artifact_register` | 已有第一版 | enum、project-relative path、revision 與 supporting files 驗證。 |
| Sandbox preview | `ArtifactPreview.tsx` | 已有第一版 | `iframe sandbox="allow-scripts"`、`srcDoc` CSP、禁止 network。 |
| Critique | `design_critique`、`CritiquePanel.tsx` | 已有第一版 | brief / brand / a11y / readiness 四分數；blocker 不可 pass。 |
| Export | Electron `subdesign:exportArtifact` | 已有第一版 | HTML、stored ZIP、`printToPDF`，有檔案數 / 50MB 限制與 SHA-256。 |
| Capability / HITL | `capabilities/subDesign.ts`、`toolGuard.ts` | 已有第一版 | create/update/export 需要權限核准；unattended 逾時拒絕規則仍沿用既有系統。 |

### 3.3 仍未形成完整產品閉環的部分

| 優先度 | 缺口 | 證據與影響 | 建議 |
|---|---|---|---|
| P0 | 與 `main` 的整合範圍過大 | 目前分支同時帶入一些非 SubDesign 改動與刪除。 | 若需回合 `main`，先拆出乾淨、可建置的整合 commit。 |
| P0 | 視覺系統完全分裂 | `SubDesignPage.tsx` 強制 `bg-[#f8f7f4]`、`[color-scheme:light]`、大量 `#c96646`；主 app 是 token 化深色 glass。 | 合併前先完成 UI re-skin，不接受兩個產品外觀並存。 |
| P1 | 持久化偏 browser-local | brief / artifact / critique / export record 都先存 Zustand + `localStorage`；artifact 本體在 workspace，metadata 不在 project。 | 將 canonical metadata 落到 `.subagents/subdesign/`，thread 僅保留 reference / summary。 |
| P1 | Preview 讀取來源未收斂 | renderer 直接走通用 `workspaceRead`，未使用已有的 `subdesign:readArtifact` IPC。 | 用專用、限長、manifest-aware IPC；將 renderer 與 artifact root 做更緊的關聯。 |
| P1 | Direction gate 未涵蓋 shell | gate 攔截 workspace tools，但 `bash` 不在 `SUBDESIGN_WRITE_TOOLS`。Plan policy 雖通常限制 bash，仍不應只靠間接政策。 | 在 linked SubDesign brief 未選 direction 時，對可寫 bash pattern 明確 deny / ask，或令 build 寫入只能經 capability tool。 |
| P1 | Critique 證據不足 | 現在是模型寫入結構化分數；沒有 screenshot / DOM / lint evidence 強制要求。 | Phase 2 再加入 screenshot / a11y evidence，並將 findings 連到 revision。 |
| P2 | 資產與模板尚未匯入 | 沒有 Open Design skill / template / design-system import 與 provenance。 | 先做 read-only preview、license / hash / URL 記錄，再由使用者確認 copy。 |
| P2 | Deck / media 合約不足 | deck 目前主要是 HTML renderer；尚不適合承諾 PPTX / MP4。 | 只有在 slide / composition schema 成熟後，才評估 PPTX / HyperFrame 類 pipeline。 |

## 4. UI/UX：一致化評估與方向

### 現有 SubAgents 視覺基線

- Palette：dark `#070b14` / navy surface，主色 cyan `#7dd8f0`，輔色 violet。
- Material：半透明 glass panel、blur、細白邊、低對比環境光。
- Typography：Sora 作標題，Inter 作 UI，預設 14px；程式碼另有 mono token。
- Shape / motion：12–20px continuous radius、spring / ease-out motion。
- Theme：有完整的 `html[data-theme='light']` token override；元件應使用 `bg-surface`、`text-on-surface`、`border-white/*` / semantic tokens，而不是寫死色票。

### 現行 SubDesign 的不一致處

| 問題 | 目前行為 | 對使用者的影響 | 修正方向 |
|---|---|---|---|
| 強制淺色 | 頁面以 `[color-scheme:light]` 與暖白底覆蓋產品主題。 | 從任何功能切入 SubDesign 像開啟另一個 app，dark/light 設定失效。 | 移除強制 theme；全面改用 semantic token。 |
| 獨立橘色品牌 | CTA、focus、進度、critique、border 皆用 `#c96646`。 | 導航 active cyan 與頁面 action orange 發生競爭，語意不一致。 | 所有主要 action 使用 `primary` / `primary-container`；warning/error 使用既有 semantic token。 |
| 雙側欄 | 全 app 已有 212px 導航；SubDesign 再放 278px 表單側欄。 | 可用寬度不足、資訊架構重複、最小 720px 更突兀。 | 將 brief 做成頁面頂部 command card，或可收合右側 inspector；全域 nav 保持唯一。 |
| 字級太小 | 廣泛使用 9–11px。 | 桌面可讀性與 a11y 均不足，也與其他頁面 12–14px 不一致。 | body 不低於 12px，主要欄位 / CTA 13–14px；僅 metadata 可用 11px。 |
| 兩套元件語言 | `rounded-md`、純白 card、灰米色 table 與既有 glass panel / rounded-xl 不同。 | 使用者無法靠既有互動預期理解控制項。 | 重用 `SettingsHeader`、`SettingsGroup`、`SettingsRow`、`SectionNav`、`.app-panel`、`settingsBtn*`。 |
| 語言切換不完整 | Traditional Chinese 與大量英文 labels 混用。 | 部分字串像工程 placeholder，而非產品文案。 | 以繁中為主；保留必要專有名詞，例如「Design system」、「HTML」。 |
| 流程斷裂 | Create brief 後跳到通用首頁 composer，SubDesign surface 不再持續呈現。 | 使用者失去 stage、artifact、critique 的定位。 | 將 thread 開啟為 `/subdesign?thread=<id>` 或在任務頁插入 SubDesign context bar / stage rail。 |

### 建議資訊架構

```text
全域側欄（不變）
  └─ SubDesign
       ├─ 頁首：標題 + 專案 / Design system +「建立設計」
       ├─ Stage rail：Brief → Direction → Build → Critique → Deliver
       ├─ 主欄：目前 stage 的內容或 artifact preview
       └─ 右側 inspector（可收合）：brief、constraints、輸出格式、recent activity
```

開始前只顯示精簡 brief card：surface、目標、platform、design system、進階 constraints。建立後，保留同一個 SubDesign workspace，不把使用者丟回沒有設計上下文的通用 composer。

### 實作準則

1. 不新增第二套 CSS color scale；只使用 `index.css` 的 theme token。
2. 不在 SubDesign component 寫 `bg-[#...]`、`text-[#...]`、`[color-scheme:light]`。
3. 提供完整 empty / loading / error / no-project 狀態，與其他 Settings-style pages 同一密度。
4. artifact preview 是內容畫布，可以是白底；**workspace chrome 不能因此改成白底**。
5. Stage 狀態不能只以色彩表達；要有文字、icon、目前 step 及可操作說明。
6. 新 UI 完成後在 dark / light、窄視窗與 Electron/純 browser fallback 下做視覺 QA。

## 5. 建議交付順序

### Milestone A — 整合範圍與回歸驗證

1. 確認目前分支中 SubDesign 的檔案、main/preload/tool registry 改動與既有功能沒有回歸。
2. 若需回合 `main`，排除與 SubDesign 無關的 OpenCode / settings / CLI runner 刪改。
3. 補齊 `npm run build`、`npm run smoke`、`npx oxlint src` 與 `git diff --check`。

### Milestone B — UI 一致化（合併前的 P0）

1. 將 `SubDesignPage` 改成既有 `ThemePage` / `SettingsChrome` / app token 組合。
2. 用單一全域側欄 + top command card / inspector 取代巢狀 278px side rail。
3. 補全 stage rail、thread context bar、artifact empty states 與繁中文案。
4. 以 dark / light 截圖對照驗收；不接受 page-specific theme override。

### Milestone C — 資料與安全閉環

1. metadata canonical source 改為 `.subagents/subdesign/briefs/`、`artifacts/<id>/manifest.json`、`critiques/`；store 是 cache，不是唯一真相。
2. 專用 artifact IPC 取代 generic workspace read，限制 manifest entry、大小與 renderer。
3. 對未選 direction 的 linked session 補上可寫 bash 防線。
4. Critique 加入 artifact revision / screenshot / accessibility evidence，最後才擴展 export。

## 6. 驗收定義

SubDesign 可視為準備發布，至少需同時滿足：

- 在目前發布分支可從側欄開啟，且不帶入無關回歸；若回合 `main`，同樣成立。
- 顏色、字體、密度、card、button、light/dark 與 SubAgents 其他頁一致。
- Brief → Direction → Build 的 gate 無法被 workspace tool 或可寫 shell 繞過。
- 每個 artifact 具有 project-relative manifest、revision、受 sandbox/CSP 保護的 preview。
- critique blocker 阻止 export；export 有 HITL、限定 destination、hash 與可追蹤紀錄。
- 重新開啟專案 / thread 後，brief、direction、artifact、critique 與 export metadata 都能恢復。

## 7. 原始碼閱讀索引

Open Design：

- [`apps/daemon/src/runtimes/defs/codex.ts`](https://github.com/nexu-io/open-design/blob/4567a0d57557b29eb79ef1f7a40826f2b801d982/apps/daemon/src/runtimes/defs/codex.ts)
- [`apps/daemon/src/artifacts/manifest.ts`](https://github.com/nexu-io/open-design/blob/4567a0d57557b29eb79ef1f7a40826f2b801d982/apps/daemon/src/artifacts/manifest.ts)
- [`packages/contracts/src/api/artifacts.ts`](https://github.com/nexu-io/open-design/blob/4567a0d57557b29eb79ef1f7a40826f2b801d982/packages/contracts/src/api/artifacts.ts)
- [`apps/daemon/src/design-systems/index.ts`](https://github.com/nexu-io/open-design/blob/4567a0d57557b29eb79ef1f7a40826f2b801d982/apps/daemon/src/design-systems/index.ts)
- [`apps/daemon/src/critique/`](https://github.com/nexu-io/open-design/tree/4567a0d57557b29eb79ef1f7a40826f2b801d982/apps/daemon/src/critique)
- [`apps/web/src/components/ProjectView.tsx`](https://github.com/nexu-io/open-design/blob/4567a0d57557b29eb79ef1f7a40826f2b801d982/apps/web/src/components/ProjectView.tsx)

SubAgents AI 目前工作分支實作（`20260712` / `63bfbb2`）：

- `app/src/pages/SubDesignPage.tsx`
- `app/src/agent/subdesign/{brief,designSystem,artifactManifest,critique,prompt,types}.ts`
- `app/src/agent/capabilities/subDesign.ts`
- `app/src/agent/tools/{registry,schemas,executor,toolGuard}.ts`
- `app/src/components/subdesign/*`
- `app/electron/{main,preload}.ts`
