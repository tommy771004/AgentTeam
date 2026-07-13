# SubDesign 建立設計工作流程：階段比對與修改計畫書（第二輪）

> 日期：2026-07-13（第二輪，銜接 `docs/SUBDESIGN_WORKFLOW_GAP_REVISION_PLAN_2026-07-13.md`）
> 範圍：同上一輪，只聚焦「開始建立設計 → 過程 → 結束」工作流程七階段。上一輪列出 4 個缺口（P1-a 證據驗證、P1-b bash 閘門、P2-a 原地調整、P2-b 記憶／預設值）與 1 個既定延後項（P3 PPTX/MP4）；本次後續實作再補上 structured tweak、Evidence semantic attestation、Screenshot/URL → reusable DESIGN.md。下文保留發現脈絡，但判定以目前程式碼為準。

## 1. 與上一輪的差異

自上一輪文件寫成後，工作區新增：`agent/subdesign/preference.ts`、`components/subdesign/ArtifactTweakPanel.tsx`；並大幅修改 `electron/main.ts`（+404 行）、`agent/tools/toolGuard.ts`、`agent/hermes/learning.ts`、`agent/subdesign/{critique,brief,types,prompt,artifactManifest}.ts`、`pages/SubDesignPage.tsx`。

重新查核上游 README，工作流程七階段描述（brief → plugin → direction → design system → artifact → handoff → memory）不變；**但上游本身也承認 critique 的證據機制與 memory 的持久化機制在公開 README 中「刻意未詳述」**（README 提示需另讀其 `AGENTS.md` 的「Daemon data directory contract」）。這代表上一輪要求 SubDesign 做到「證據可獨立驗證」「記憶機制透明」，其實已經**超越**上游公開文件揭露的嚴謹度——這點在下方判定中列為加分，不算義務。

## 2. 逐項核實結果

| 上一輪缺口 | 現況 | 證據 | 判定 |
|---|---|---|---|
| **P1-a：Critique evidence 只驗結構不驗存在性** | `verifySubDesignEvidence` 除了 path containment、存在性、新鮮度與 PNG/HTML 結構，也核對 main-process HMAC attestation、SHA-256、artifact revision/kind/source/path；`design_artifact_lint` 另檢查 HTML 語意與目前 entry hash。 | `main.ts` 的 `verifySubDesignEvidenceContent()`、`attestSubDesignEvidence()`、`readAndVerifyEvidenceAttestation()`、`lintSubDesignArtifact()` | **完成（來源 attestation＋基本語意驗證）** |
| **P1-b：Bash 方向閘門白名單放行、fail-open** | 邏輯整個翻轉：新的 `isSubDesignReadonlyBashCommand`（`toolGuard.ts:60-68`）**預設拒絕**——含 shell 特殊字元（`` ` $() < > ``）直接判定非唯讀；含 `curl/wget/nc/ssh/scp/sftp/npm/pnpm/yarn/bun/cargo/pip/python...` 等直接判定非唯讀；`git` 只允許 `status/diff/log/show/branch --show-current/rev-parse/ls-files`；其餘每個以 `&&`/`\|\|`/`;`/`\|` 切開的片段都要符合嚴格唯讀前綴（`pwd/ls/cat/head/tail/grep/rg/find/fd/sort/uniq/wc/echo/printf/which/type/command -v/env/printenv/sed(不含 -i)/awk`）才算唯讀。`isSubDesignWritableBashCommand` 現在只是 `!isSubDesignReadonlyBashCommand(...)`。 | `toolGuard.ts:52-73` | **完成**——符合上一輪建議的「預設拒絕，唯讀才放行」。`curl -o file` 現在會被攔截。 |
| **P2-a：無原地調整機制** | artifact manifest 可宣告 color/text/number/select/boolean controls；`design_artifact_tweak` 與 `ArtifactTweakPanel` 做型別、範圍、exact replacement 與 revision 驗證，沒有宣告 control 時仍保留 CSS custom property inferred fallback；agent 與人類路徑都受 main-process direction gate。 | `main.ts` 的 `applySubDesignArtifactTweak()`、`executor.ts`、`ArtifactTweakPanel.tsx`、`artifactManifest.ts` | **完成（structured live tweak＋exact fallback）** |
| **P2-b：無記憶／預設值累積** | `preference.ts` 以專案 metadata 的最新有效 pass 為 canonical；只有 briefs/artifacts/critiques 都缺失時，才依共用的 project key 從 Hermes memory 的 `subdesign-preference` entries fallback。patch 後 revision mismatch 的舊 metadata 不會被 memory 復活；`onSubDesignPass()` 與 fallback 共用同一個 key helper。 | `agent/subdesign/preference.ts`、`agent/hermes/learning.ts`、`pages/SubDesignPage.tsx` | **完成（metadata-first + Hermes fallback）** |
| **P3（歷史延後項）：PPTX/MP4 export** | 都已有真實輸出，非 stub；PPTX 是單頁摘要 OOXML，MP4 是截圖後由外部 `ffmpeg` 編碼的 3 秒靜態縮圖。UI、prompt、capability runbook 已明確揭露此保真度，未宣稱逐頁 deck 或動態影片。 | `main.ts`、`ArtifactDeliveryPanel.tsx`、`prompt.ts` | **完成（能力邊界已揭露）** |
| **後續需求：Evidence 語意真偽判定** | capture/lint 由 main process 產生 attested evidence；verify 重新計算 hash、驗 HMAC、核對 artifact revision 與 lint entry hash，並拒絕模型自行偽造的 evidence。 | `main.ts`、`critique.ts`、`executor.ts` | **完成** |
| **後續需求：Screenshot/URL 匯入並生成 reusable DESIGN.md** | `ReferenceImportPanel` 可匯入 project-relative screenshot 或公開 URL snapshot；main process 保存 reference/hash，分析 URL token，建立 DESIGN.md 與未選定 direction card。 | `ReferenceImportPanel.tsx`、`main.ts`、`brief.ts`、`prompt.ts` | **完成** |

## 3. 本輪新發現的殘餘缺口

### 3-1　Evidence 內容未做真偽驗證（P1-a 的延伸，已處理）
本次已補上 main-process HMAC attestation、SHA-256、來源／revision／kind／path 核對與 `design_artifact_lint`。模型透過 `workspace_write` 塞入 evidence 目錄的檔案沒有有效 attestation，不能通過 required evidence 驗證；lint 也必須對應目前 artifact entry hash。這裡的「語意」是 deterministic 基本檢查，不宣稱取代人工設計評審。

### 3-2　`design_artifact_patch` 的直接 IPC 路徑不受 direction gate 管control
`toolGuard.ts` 的 direction gate 是在 renderer 端 agent 工具呼叫（`authorizeTool`）時判斷；但 `ArtifactTweakPanel.tsx` 呼叫的是 `window.subagents.subdesign.patchArtifact` → `main.ts:1712` `patchSubDesignArtifact`，這是**人類直接點面板觸發的 IPC**，不經過 `authorizeTool`。也就是說：使用者可以在 agent 從未選定 direction 的情況下，手動用面板直接改掉 artifact 檔案。這與上一輪計畫書寫的「沿用既有 revision 與 direction gate 規則」不完全相符。
**上一輪風險已收斂**：main-process patch 現在會讀 canonical brief 並拒絕未選 direction；人類手動與 agent 路徑一致。

### 3-3　PPTX/MP4 保真度遠低於「已支援匯出」給人的印象
- PPTX：`buildPptxFiles` 固定產生**單一投影片**，內容來自 `plainTextFromArtifact` 把 HTML 硬轉純文字、最多 24 行、每行 110 字截斷；deck 類型（多頁）的 artifact 匯出成 PPTX 只會得到一張摘要投影片，不是逐頁對應。
- MP4：`exportSubDesignMp4` 實際上是「截一張靜態畫面、用 ffmpeg 編碼成 3 秒靜止影片」（`-loop 1 -i framePath -t 3`），沒有動畫、沒有多幀、沒有時間軸。且**依賴系統已安裝 ffmpeg**（未 bundle），環境沒裝就整個 export 失敗。
**上一輪風險已收斂**：產品文案／UI 現在明確揭露「單頁摘要 PPTX」「3 秒靜態縮圖 MP4」，不宣稱逐頁 deck 或動態影片。

### 3-4　記憶機制是兩條平行線，非單一資料來源
`preference.ts`（決定性、讀專案內 metadata 檔）與 `learning.ts` 的 Hermes memory（供一般 agent 對話 context 使用）各自獨立寫入、獨立讀取，沒有共用同一份「這個專案上次設計偏好」的真相來源。長期可能出現兩者不同步（例如 Hermes memory 被使用者手動編輯/清除，但 `preference.ts` 仍讀到舊 metadata；反之亦然）。
**上一輪風險已收斂**：preference metadata 是 canonical；只有 canonical metadata 缺失時，才按相同 project key 從 Hermes memory fallback。若 metadata 存在但最新 pass 因 revision 失效，不會用舊 memory preference 復活。

### 3-5　Screenshot／URL 匯入與 reusable DESIGN.md（已處理）
`ReferenceImportPanel` 會把 project-relative screenshot 或公開 URL snapshot 交給 main process；main process 保存原始 reference、SHA-256、token 摘要與 generated DESIGN.md，並在 brief 追加方向卡但不自動選定方向。URL 內容只作 untrusted reference data，不執行其 script 或 instructions。

## 4. 修改計畫書（第二輪）

### R2-P1：Evidence 真偽的最低限度驗證（已完成，後續增強為 attestation + semantic lint）
- 檔案：`electron/main.ts`（`verifySubDesignEvidence` 旁）
- 工作：對 screenshot/DOM/lint evidence 實施 PNG/HTML/JSON 結構檢查、SHA-256、main-process HMAC attestation 與 artifact revision/source/path 核對；lint 另驗證 HTML 結構、title、圖片 alt、互動元素名稱與 current entry hash。
- 驗收：塞一個非 PNG 內容但檔名 `.png` 的 evidence，`kind==='screenshot'` 驗證應失敗。

### R2-P2：`patchArtifact` IPC 路徑補上 direction gate 檢查（已完成）
- 檔案：`electron/main.ts`（`patchSubDesignArtifact`）或改為要求呼叫端傳入並驗證 `selectedDirectionId`
- 工作：`patchSubDesignArtifact` 執行前，讀取對應 brief 的 `selectedDirectionId`，未選定時拒絕（回傳與 agent 工具路徑一致的錯誤訊息），讓「Build 前必須先選 direction」在人類手動路徑與模型路徑上行為一致。
- 驗收：未選 direction 的 brief，透過 `ArtifactTweakPanel` 送出 patch 應被拒絕，UI 顯示與 agent 路徑相同的 direction gate 訊息。

### R2-P3：PPTX/MP4 揭露與（可選）多頁 PPTX 支援（揭露已完成）
- 檔案：`agent/subdesign/prompt.ts`、`SubDesignExportFormat` 使用處（`ArtifactDeliveryPanel.tsx` 等 UI）
- 工作（必做）：UI、prompt、capability runbook 都揭露「單頁摘要」「3 秒靜態縮圖，需系統安裝 ffmpeg」。
- 工作（可選，視需求）：若 artifact `kind==='deck'` 且有結構化分頁資料，`buildPptxFiles` 改為逐頁產生 slide；沒有結構化分頁資料前不必勉強做。
- 驗收：PPTX/MP4 匯出按鈕旁文案準確反映目前保真度；deck 類型如未做多頁，不得在文案中宣稱「逐頁匯出」。

### R2-P4（可選，優先度較低）：統一記憶來源（已完成 metadata-first fallback）
- 檔案：`agent/subdesign/preference.ts`、`agent/hermes/learning.ts`
- 工作：`findLatestPassedSubDesignPreference()` 以 project metadata 為 canonical；只有 briefs/artifacts/critiques 都缺失時，才從相同 project key 的 Hermes `subdesign-preference` entries fallback。`onSubDesignPass()` 共用同一個 project key helper，避免 key 漂移。
- 驗收：清除其中一條資料來源後，另一條仍能提供合理預設值，而不是靜默失效。

### R2-P5：結構化即時 tweak panel（已完成）

- manifest 宣告 `color`／`text`／`number`／`select`／`boolean` controls，panel 與 `design_artifact_tweak` 共用 main-process validator；未宣告 controls 時由 CSS custom properties 提供 inferred fallback。

### R2-P6：Screenshot／URL → reusable DESIGN.md（已完成）

- `subdesign:importReference` 保存 source snapshot、hash、reference manifest，建立 `.subagents/subdesign/design-systems/<id>/DESIGN.md`；UI 自動追加可比較的 imported direction card，但維持使用者選擇 gate。

## 5. 已採用的實作決策

1. **R2-P3 多頁 PPTX**：本輪不做。artifact manifest 尚無 slide/page schema，因此維持單頁摘要並在 UI 明確揭露，避免產生錯誤的逐頁交付承諾。
2. **R2-P4 記憶來源**：採 metadata-first；Hermes memory 只在 canonical metadata 缺失時 fallback。清除 Hermes memory 不影響 metadata 預設值；清除 metadata 時仍可由同專案 Hermes preference 提供合理 fallback。
3. **R2-P5 structured tweak**：採 manifest-driven controls + exact patch fallback；沒有宣告 control 時只推導 CSS custom properties，避免任意猜測檔案結構。
4. **R2-P6 reference import**：採安全 bounded snapshot、hash、generated DESIGN.md 與未選定 direction card；外部內容不具備 instruction authority。

## 6. 驗收定義（第二輪更新）

- [x]（沿用第一輪）啟動／方向鎖定／design system 注入／canonical persistence／專屬 export IPC。
- [x] Critique evidence 有伺服器端存在性＋新鮮度＋路徑封閉驗證。
- [x] Bash 方向閘門改為預設拒絕。
- [x] 可對已生成 artifact 做有限範圍的原地 patch，不必整輪重跑 agent。
- [x] 同專案第二次建立設計可帶出前次已確認的偏好作為預設值。
- [x] PPTX／MP4 匯出有真實輸出且失敗時訊息明確。
- [x] Evidence 內容通過最低限度真偽檢查（不只是「存在」）。
- [x] 人類手動觸發的 artifact patch 與 agent 觸發的 patch 遵守同一組 direction gate 規則。
- [x] PPTX/MP4 匯出的 UI 文案如實反映「單頁摘要／靜態縮圖」的保真度。
- [x] 記憶／偏好以 metadata 為 canonical，並明確定義 Hermes fallback 順序。
- [x] artifact 支援結構化即時 tweak panel，並保留 exact patch fallback。
- [x] Evidence 具備 main-process provenance attestation、hash 與 deterministic semantic lint。
- [x] Screenshot／URL 可匯入並自動產生可重用、可追溯的 DESIGN.md 與 direction card。
