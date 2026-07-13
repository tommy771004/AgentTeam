# SubDesign 建立設計工作流程：階段比對與修改計畫書

> 日期：2026-07-13
> 範圍：只聚焦「使用者開始建立設計 → 過程 → 結束」的完整工作流程七階段，逐階段比對 Open Design（`nexu-io/open-design`）與 SubDesign 現況。架構層（daemon/CLI adapter/plugin runtime）比較已由既有三份文件涵蓋，本文不重複：
>   - `docs/SUBDESIGN_OPEN_DESIGN_INTEGRATION_PLAN.md`（整體整合計劃）
>   - `docs/SUBDESIGN_OPEN_DESIGN_ANALYSIS_2026-07-13.md`（原始碼與 UI/UX 分析，基準 commit `63bfbb2`）
>   - `docs/OPEN_DESIGN_PLUGIN_AGENT_INTEGRATION_PLAN_2026-07-13.md`（plugin/agent 導入計畫）
> 基準差異：上列文件基準為 `63bfbb2`（2026-07-12）。本文基準為目前工作區狀態，含已提交的 `a533c44` 與**大量尚未提交的變更**（brief/critique/prompt/types/metadata、SubDesignPage 幾乎全面重寫、新增 `agent/openDesign/*`、`templateCatalog.ts`、`openDesignPackStore.ts`、vendored `app/public/open-design/`）。這些變更已經修復了舊文件列出的多數 P0/P1 缺口，因此本文的結論與舊文件不同，請以本文的逐階段判定為準。

## 1. Open Design 的建立設計工作流程（七階段）

依上游 README 描述，Open Design 的流程是 **brief → plugin → direction → design system → artifact → handoff → memory**：

| # | 階段 | 內容 |
|---|---|---|
| 1 | **啟動 Start** | 使用者在 Home 選擇 skill（web prototype / dashboard / deck 等）、挑選 design system，送出 brief。 |
| 2 | **鎖定方向 Direction lock** | 系統提供精選方向，或允許從截圖／URL 匯入；agent 將方向固化為可重用的 `DESIGN.md`。 |
| 3 | **串流生成 Streaming generation** | agent 讀取現用 `DESIGN.md`，將 artifact 串流進 sandboxed iframe；**"editable in place — not regenerate from scratch"**。 |
| 4 | **設計系統注入 Design system injection** | 「每次 render 都讀取現用 `DESIGN.md`」——9 節 schema：palette、type、spacing、motion、voice、anti-pattern。 |
| 5 | **迭代與評鑑 Iteration & critique** | Artifact 即時串流並帶 tweak panel，使用者可**不重新整理就調參**；自我評鑑 skill 給五維度分數。 |
| 6 | **交付 Export & handoff** | 匯出 HTML（inline）、PDF、PPTX、MP4（HyperFrames）、ZIP；設計師可透過 Cursor/Claude Code 交接給工程，或行銷直接拿 PPTX/PDF。 |
| 7 | **記憶 Memory** | 截圖、字體、色票、已確認的 artifact 會累積成往後 session 的預設值。 |

## 2. SubDesign 現況逐階段比對

| 階段 | SubDesign 現況 | 證據 | 判定 |
|---|---|---|---|
| **1. 啟動** | `SubDesignBrief` 現含 `templateId`、`skillIds?`、`designSystemId`、`provenance?`（`agent/subdesign/types.ts:31-34`）。真實 catalog：`agent/openDesign/catalog.ts` 解析 vendored `public/open-design/OPEN_DESIGN_INVENTORY.json`，帶 `sourceUrl`/`upstreamCommit`/`digest`/`licensePaths`；`templateCatalog.ts` 提供 28 個本地模板 + `openDesignRecordToTemplate()` 轉換上游紀錄；`openDesignPackStore.ts` 管理 pack 安裝／啟用／停用／reindex，並有 `bundled/community-reviewed/local-user/remote-unverified` 信任分級（`packs.ts:132`）。**已接到 UI**：`SubDesignPage.tsx` 掛載時載入 catalog、合併本地與上游模板、選取後把 `templateId/skillIds/provenance` 一起送進 `createBrief`。 | `agent/subdesign/{types,brief,templateCatalog}.ts`、`agent/openDesign/{catalog,packs}.ts`、`store/openDesignPackStore.ts`、`pages/SubDesignPage.tsx` | **已完成** |
| **2. 方向鎖定** | `design_direction_select` 寫入 `brief.selectedDirectionId`；`toolGuard.ts:134` 對 `SUBDESIGN_WRITE_TOOLS ∪ {'bash'}` 一律先查 direction 是否已選。 | `agent/tools/toolGuard.ts:41-50,120-145` | **已完成**（詳見 §3 殘餘風險） |
| **3. 串流生成 / 原地編輯** | Build stage 仍支援 agent 產生/覆寫 artifact；`ArtifactTweakPanel` 同時支援 manifest 宣告的 color/text/number/select/boolean structured controls，以及從 CSS custom properties 推導的安全 fallback；`design_artifact_tweak`／`design_artifact_patch` 都由 main process 驗證 path、型別、範圍、匹配數與大小，成功後建立新 revision 並自動把 brief 送回 Critique。 | `components/subdesign/ArtifactTweakPanel.tsx`、`electron/main.ts` 的 `applySubDesignArtifactTweak()`、`agent/tools/executor.ts` | **已完成**（結構化即時調參＋exact patch fallback） |
| **4. 設計系統注入** | `designSystem.ts` 讀取 root `DESIGN.md` 或 `.subagents/subdesign/design-systems/<id>/DESIGN.md`，`formatDesignSystemContext()` 產生摘要；`prompt.ts` 在 `buildSubDesignRuntimeContext` 與 `buildSubDesignPrompt` 兩處都注入，並新增上游 provenance（digest/license/來源 URL）文字。 | `agent/subdesign/designSystem.ts:10-14,164-178`、`prompt.ts:40-47,80-96,112` | **已完成** |
| **5a. 評鑑 Critique** | `critiqueHasRequiredEvidence()` 強制要求 screenshot／dom／lint 三類；`design_artifact_capture` 與 `design_artifact_lint` 由 main process 產生 evidence、SHA-256 與 HMAC attestation，`verifySubDesignEvidence()` 重新驗證簽章、檔案 hash、artifact revision、kind/source 與 lint 對應的 entry hash；模型自行寫入的假 evidence 無法通過 Deliver gate。 | `agent/subdesign/critique.ts`、`electron/main.ts` 的 `attestSubDesignEvidence()`／`readAndVerifyEvidenceAttestation()`／`lintSubDesignArtifact()` | **已完成**（來源 attestation＋基本語意 lint） |
| **5b. 即時調參** | SubDesignPage 在 artifact preview 下方提供結構化 live tweak panel；支援 draft、color/number/select/boolean/text controls、HITL、revision refresh，以及 advanced exact patch。 | `components/subdesign/ArtifactTweakPanel.tsx`、`pages/SubDesignPage.tsx`、`store/subDesignArtifactStore.ts` | **已完成** |
| **5c. Screenshot／URL 匯入** | Brief 可匯入專案內 screenshot 或公開 URL snapshot；main process 保存原始 reference 與 SHA-256，抽取 URL 的 palette/font/spacing/radius/headings token，產生 `.subagents/subdesign/design-systems/<id>/DESIGN.md`，並在 UI 自動新增未選定的 direction card，保留人工選擇 gate。 | `components/subdesign/ReferenceImportPanel.tsx`、`electron/main.ts` 的 `importSubDesignReference()`、`agent/subdesign/{brief,prompt}.ts` | **已完成**（可追溯 reusable DESIGN.md） |
| **6. 交付 Export** | `subdesign:exportArtifact` 已支援 HTML、ZIP、PDF、單頁 OOXML PPTX；MP4 走 sandbox screenshot + 本機 ffmpeg 產生 3 秒 preview，並由 `subdesign:exportCapabilities` 探測 encoder，缺少 ffmpeg 時 UI 與 agent 都明確回報不可用。所有格式都要求通過 critique/evidence gate 與 HITL。 | `electron/main.ts` 的 `exportSubDesignArtifact()`、`buildPptxFiles()`、`exportSubDesignMp4()`、`components/subdesign/ArtifactDeliveryPanel.tsx` | **已完成**（MP4 依本機 encoder 能力啟用） |
| **7. 記憶 Memory** | Critique pass 會經 Hermes learning 記錄 SubDesign preference；SubDesignPage 會從目前 project 的 briefs/artifacts/critiques 找到仍與最新 revision 對應的 pass，預填 design system、template、skill/provenance 等選項。patch 後舊 pass 因 revision mismatch 自動失效。 | `agent/hermes/learning.ts`、`agent/subdesign/preference.ts`、`pages/SubDesignPage.tsx` | **已完成** |

### 附帶已驗證：先前文件列的 P0/P1 缺口目前狀態

| 舊文件缺口（基準 `63bfbb2`） | 現況 |
|---|---|
| P0：SubDesignPage 強制淺色 `[color-scheme:light]`、`bg-[#f8f7f4]`、大量 `#c96646` 橘色 | **已修復**——全檔 grep 這三個字串零命中；已改用 `bg-background`、`bg-surface-container-low`、`border-primary/40`、`bg-primary text-on-primary` 等既有語意 token，僅剩的字面色是符合主色調的 cyan glow（`rgba(43,184,217,...)`）。 |
| P1：Direction gate 未涵蓋 `bash` | **已修復**——`toolGuard.ts:134,140-144` 現在對 `bash` 呼叫 `isSubDesignWritableBashCommand()` 做啟發式攔截（見下方殘餘風險）。 |
| P1：Metadata 只存 Zustand + localStorage，未落地專案檔案 | **已修復**——新增 `agent/subdesign/metadata.ts`，四個 store（brief/artifact/critique/export）皆呼叫 `persistSubDesignMetadata()`，main process 寫入 `.subagents/subdesign/{briefs,artifacts,critiques,exports}/...`（`main.ts:1714-1719,2008-2024`）；localStorage 降級為離線快取，`subDesignPersistence.ts` 負責從 canonical 檔案 hydrate。 |
| P1：Preview 走 generic `workspaceRead` | **已修復**——`ArtifactPreview.tsx:29-35` 優先呼叫專用 `subdesign:readArtifact`（`main.ts:2030-2037`，經 `artifactFile()` 做 symlink/traversal 檢查），只在該 API 不存在時退回 generic read。 |
| P2：資產與模板尚未匯入（Open Design skill/template/design-system + provenance） | **已完成**（見上表第 1 階段）。 |

## 3. 缺口總表（依優先度）

| 優先度 | 缺口 | 影響 | 建議 |
|---|---|---|---|
| P1 | Critique evidence 只驗結構不驗存在性／真偽 | 已由 main process 驗證 evidence path、存在性、containment、mtime、PNG/HTML 結構、SHA-256/HMAC attestation、artifact revision 與 lint 語意對應；不合格會強制 needs-revision 且阻擋 Deliver | 已完成：`subdesign:verifyEvidence`、`subdesign:captureEvidence`、`subdesign:lintEvidence` |
| P1 | `isSubDesignWritableBashCommand` 是白名單式正則，非白名單即放行 | 未選 direction 時已改成唯讀命令明確放行，其餘 bash 預設進入 gate/approval；寫檔、curl/wget、redirect 等皆不再靠有限寫入樣式判定 | 已完成：`agent/tools/toolGuard.ts` |
| P2 | 沒有「原地調參 / 不重新生成」的迭代機制 | 已提供 structured tweak panel、`design_artifact_tweak` 與 exact patch fallback；不重跑 agent、不改 manifest kind/renderer/entry，revision 與 critique gate 仍完整 | 已完成：`design_artifact_tweak` + `design_artifact_patch` |
| P2 | 沒有 Screenshot／URL → reusable DESIGN.md 匯入路徑 | 已提供安全 screenshot/URL import、reference manifest、hash、token 摘要、DESIGN.md 生成與 direction card；不自動選定方向 | 已完成：`ReferenceImportPanel` + `subdesign:importReference` |
| P2 | 無 Memory／預設值累積 | pass 後保存 preference，下一個 brief 預填最新仍有效的 design system/template 等選擇；新 revision 會使舊 pass 失效 | 已完成：Hermes learning + `findLatestPassedSubDesignPreference()` |
| P3（沿用既有計畫，非新缺口） | 歷史上的 PPTX／MP4 export 缺口 | 已補上單頁 OOXML PPTX；MP4 為可探測的本機 ffmpeg 路徑，無 encoder 時不宣稱支援 | 已完成：Electron export capabilities |

## 4. 修改計畫書

### P1-a：Critique 證據存在性驗證

- 檔案：`agent/subdesign/critique.ts`、`electron/main.ts`（新增 IPC，例如 `subdesign:verifyEvidence`）
- 工作：
  1. 定義 evidence 允許的 path 只能落在 `.subagents/subdesign/critiques/<artifactId>/evidence/` 或 artifact 自身 supporting files 內。
  2. Main process 對每筆 evidence 做 `existsSync` + `mtime >= artifact.updatedAt` 檢查；不存在或過期一律視為缺少該類別 evidence，套用既有 `critiqueHasRequiredEvidence` 的「強制 needs-revision」邏輯。
  3. Screenshot 類 evidence 改由既有 offscreen `BrowserWindow` capture 工具產生（可重用 export PDF 的 offscreen window 手法），回傳 path 給模型引用，而不是讓模型憑空寫 path。
- 驗收：手動在 evidence.path 填入不存在檔案，critique 結果必須被強制降為 `needs-revision` 且無法 Deliver。

### P1-b：Bash 方向閘門改為預設拒絕

- 檔案：`agent/tools/toolGuard.ts`
- 工作：將 `isSubDesignWritableBashCommand` 的語意從「符合已知寫入樣式才擋」改為「符合已知唯讀樣式（`ls`/`cat`/`grep`/`git status`/`git diff`/`git log`/`pwd`/`echo` 不含重導向等）才放行，其餘一律視為需要 ask」，未選 direction 時沿用既有 `SubDesign direction gate` 拒絕訊息。
- 驗收：`curl -o out.html https://...`、`dd if=... of=...` 等未在舊白名單中的命令，在未選 direction 時必須被攔截。

### P2-a：輕量原地調整路徑（已採用）

- `design_artifact_patch` 工具與 `ArtifactTweakPanel` 都走 main-process `subdesign:patchArtifact`，限制只能對既有 manifest 的 entry/supporting file 做 exact replacement，不可變更 kind/renderer/entry。
- main process 檢查 project-relative containment、symlink、純文字、匹配數（1–12）、單次文字大小與最多 12 個 operations；成功後 revision +1、canonical metadata 更新，brief 回到 critique。
- `critique`／`toolGuard` 沿用既有 revision、approval 與 direction gate 規則，不強制整檔重寫。
- 驗收：一次 tweak 不需要使用者重新走 direction/critique 全流程，且 revision 記錄仍完整可回放。

### P2-c：結構化即時調參（已完成）

- artifact manifest 可宣告 `color`、`text`、`number`、`select`、`boolean` controls；每個 control 綁定 existing exact replacement 與 `{{value}}` template。
- panel 會做 draft、型別／範圍檢查、HITL 與 revision refresh；沒有宣告 controls 時，僅從 CSS custom properties 推導安全 fallback，不臆造任意檔案結構。
- `design_artifact_tweak` 與 panel 共用 `subdesign:applyTweak`，agent 與人類路徑一致。

### P2-d：Evidence 語意真偽判定（已完成）

- main process 產生 screenshot/DOM/lint evidence 時寫入 SHA-256 與 HMAC attestation；verify 會核對來源、kind、artifact revision、path、hash 與 lint 的 current entry hash。
- semantic lint 對 HTML 檢查根節點、head/body/title、圖片 alt、button/link accessible label；lint 結果也必須由 main process attestation 才可作為 Deliver evidence。

### P2-e：Screenshot／URL 匯入與 reusable DESIGN.md（已完成）

- screenshot 僅接受 project-relative image 或 bounded data URL；URL 僅接受公開 http/https HTML snapshot，來源內容視為 untrusted reference data，不執行其中指令。
- 匯入後保存 reference、hash、分析摘要與 `.subagents/subdesign/design-systems/<id>/DESIGN.md`，UI 新增 direction card 但維持使用者選擇 gate。

### P2-b：Memory／預設值累積

- 檔案：`agent/hermes/learning.ts`（擴充）、`agent/subdesign/{brief,critique}.ts`、`pages/SubDesignPage.tsx`
- 工作：
  1. Critique verdict 轉為 `pass` 時，呼叫既有 learning 管線寫入一筆「SubDesign 偏好」記憶（design system id、template id、palette、platform）。
  2. `SubDesignPage.tsx` 建立新 brief 前，讀取該專案最近一次 `pass` 記憶作為表單預設值（可被使用者覆蓋，不強制）。
- 驗收：同一專案完成一次 `pass` 設計後，重新開啟 SubDesign 建立畫面，先前的 design system／template 選擇會出現為預設而非空白。

## 5. 已採用的實作決策

1. **原地調參**：採用 manifest-driven structured controls 搭配 exact patch fallback；它直接修改已登記 artifact，不重新生成整份檔案，並以 revision 讓 critique/preview 可追蹤。
2. **Critique screenshot 來源**：採用 main-process offscreen `BrowserWindow` 產生 screenshot/DOM evidence；模型只能引用工具回傳的 project-relative path。
3. **Evidence 真偽**：採用 main-process HMAC attestation＋SHA-256 與 deterministic semantic lint；不把模型自行寫入的檔案視為可信 evidence。
4. **Screenshot／URL import**：採用 reference snapshot + hash + generated DESIGN.md + 未選定 direction card；外部內容永遠只作為 untrusted reference data。
5. **MP4**：先提供單一 artifact 的 3 秒靜態 preview pipeline；是否能啟用由本機 `ffmpeg -version` capability probe 決定，完整 HyperFrames composition 仍由專用 video workflow 處理。

## 6. 驗收定義（更新版）

SubDesign 的「建立設計工作流程」可視為與 Open Design 對齊，需同時滿足：

- [x] 啟動階段可選 template／skill／design system，且帶完整 provenance（來源、授權、digest）。
- [x] 未選 direction 前，workspace write 與可疑 bash 一律被攔截。
- [x] Design system（`DESIGN.md`）在每次 build 都被讀取並注入 prompt。
- [x] Critique 結構性要求 screenshot／DOM／lint 三類 evidence 才能 pass。
- [x] Brief／artifact／critique／export 的 canonical metadata 落在 `.subagents/subdesign/`，重開專案可還原。
- [x] Export HTML／ZIP／PDF／PPTX 走專屬 IPC；MP4 走可探測的 ffmpeg pipeline，manifest 與 path 皆受 containment 檢查。
- [x] Critique evidence 存在性由 main process 獨立驗證，而非只信模型回報。
- [x] Critique evidence 的來源、hash、revision 與基本語意由 main process 獨立驗證。
- [x] Bash 方向閘門改為唯讀明確放行、其他命令預設進入 gate/approval。
- [x] 使用者可在不整輪重跑 agent 的情況下微調已生成 artifact。
- [x] 同專案第二次建立設計時，能帶出前次已確認的 design system／template 作為預設值。
- [x] Artifact 有結構化即時 tweak controls，並保留 exact patch fallback。
- [x] Screenshot／URL 可匯入並自動生成可重用、可追溯的 `DESIGN.md` 與 direction card。
