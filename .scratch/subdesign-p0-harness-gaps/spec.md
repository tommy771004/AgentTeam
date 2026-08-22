# SubDesign P0 harness gaps：Critique gates、指向式回饋、Revision snapshots

Status: 可交給代理
日期：2026-08-22
來源：`docs/research/claude-design-clones-harness-comparison.md`（2026-08-22 競品研究）的 P0 建議；哲學地基為 ADR-0048（model cannot manufacture execution evidence）與 AGENTS.md 的 `runTask` 單一入口規則。

## Problem Statement

一位用 SubDesign 做產品設計的使用者，今天會遇到三個卡點：

1. **Critique 說 pass，但分數無法驗證。** Critique theater 給出四項 0–100 分數，這些數字可能只是模型「自述」的測量結果。使用者無從知道對比度、console error、build 是否真的被檢查過——等於設計品質的最後一道關卡是模型自己說了算。
2. **看到問題只能用文字描述位置。** 使用者在 artifact 預覽裡看到某個按鈕間距錯了，只能打字描述「第三頁右邊那個按鈕」，再祈禱 agent 找到同一個元素。現有的 structured tweaks 是模型預先宣告的 find/replace，不是使用者「指著說改哪裡」的操作方式。
3. **AI 改壞了回不去。** Artifact 有 revision 編號，但沒有快照、還原或並排 diff。一次失敗的修訂會覆蓋掉前一版，使用者的唯一手段是重跑整個 run。

## Solution

1. **Critique verification gates**：把 contrast／state-aware WCAG、console error、build success、token 一致性等檢查實作為註冊式 Pi Core tools（gates）。Gate 輸出寫入 critique evidence；**panelist 分數必須引用 gate 輸出，否則 verdict 不得為 pass**——gate 沒跑就不能報分數，fail-closed。
2. **Element-pinned comment → scoped patch**：在 ArtifactPreview 外層加 pin 模式。使用者點擊渲染元素、留一句話，host 端把 pin 編譯成結構化 patch operations，經 workspace controller 的 follow-up 進入單一 `runTask` 迭代，agent 只修正該區域。
3. **Artifact revision snapshot / restore / diff**：artifact store 為每個 revision 保存完整檔案快照（entry + supportingFiles + sha256）。使用者可還原到任一舊版（還原本身是一個新 revision，歷史不可改寫）、並排 diff 兩個 revision。

三項都走既有接縫：tool registry + critique store 驗證、workspace controller fake-deps、artifact store。

## User Stories

### Critique verification gates

1. As a SubDesign 使用者, I want critique 分數由實際執行的 gate 產出, so that 我可以相信「pass」代表品質而不是模型的自信。
2. As a SubDesign 使用者, I want gate 沒跑時 verdict 自動 fail-closed 為 needs-revision, so that 沒有靜默的假通過。
3. As a reviewer, I want 每個分數旁顯示產生它的 gate 記錄（gate 名稱、時間戳、輸入摘要）, so that 我可以逐項查帳。
4. As a reviewer, I want evidence 帶 sha256 與 path 可追溯, so that 我能比對 gate 跑當下的 artifact 內容。
5. As an AFK agent, I want 以 tool 形式呼叫 gates（contrast、console-error、build-success、token-consistency、responsive overflow）, so that 我的 critique 有 non-model evidence 支撐。
6. As a SubDesign 使用者, I want state-aware contrast 檢查（hover/focus/active 的真實 computed style）, so that WCAG 結論反映互動狀態而非只有靜態色值。
7. As a 維護者, I want gate 工具走既有 tool registry 與 capability admission, so that gates 不需要新的執行迴圈或特權路徑。
8. As a 維護者, I want critique store 在 verdict=pass 但缺必要 gate evidence 時拒絕記錄, so that 型別層就擋住 model-attested 分數混進交付判定。

### Element-pinned comments

9. As a SubDesign 使用者, I want 在預覽上點任何元素放 pin 並留言, so that 我可以用「指」的方式表達修改意圖而不用猜 selector。
10. As a SubDesign 使用者, I want pin 提交後 agent 只重寫該 region, so that 其他頁面與元件不會被順手改動。
11. As a SubDesign 使用者, I want pin 的選取解析由 host 注入的唯讀 script 完成, so that 渲染內容中的任何 script 都無法偽造或攔截我的回饋。
12. As a 維護者, I want pin payload 經 schema validation 後才進 follow-up, so that 不可信的 iframe 內容無法把任意資料注入 prompt 或 patch。
13. As a SubDesign 使用者, I want 提交 pin 時看到即將送出的結構化 patch 摘要, so that 我確認的是具體操作而非一句模糊指令。
14. As a reviewer, I want pin 留言保留為可稽核記錄（region + 文字 + 時間戳 + 觸發的 runId）, so that 之後能回答「這裡為什麼變了」。
15. As an AFK agent, I want 收到結構化的 pinned-comment 輸入而非自由文字, so that 我能在單次 runTask 迭代內完成 scoped 修正而不需要追問。
16. As a 維護者, I want pinned-comment 的執行與其他 follow-up 完全同軌（同一 controller、同一 `runTask`）, so that 不存在繞過治理的第二入口。

### Revision snapshot / restore / diff

17. As a SubDesign 使用者, I want 每次 revision 都自動保存完整檔案快照, so that 任何一版都能事後檢視。
18. As a SubDesign 使用者, I want 一鍵還原到任一舊 revision, so that 失敗的修訂不會毀掉可用版本。
19. As a SubDesign 使用者, I want 還原以「新 revision」呈現而非覆寫歷史, so that 時間線永遠真實、可審計。
20. As a SubDesign 使用者, I want 並排 diff 兩個 revision 的檔案差異, so that 我能在採用前看懂 agent 到底改了什麼。
21. As a SubDesign 使用者, I want 快照帶 sha256, so that 內容完整性可驗證、可比對。
22. As a 維護者, I want 快照儲存於 project-relative workspace store 且遵守既有大小/數量上限模式, so that 專案資料夾不被無限膨脹。
23. As a SubDesign 使用者, I want run 進行中（live）時禁止 restore/diff 寫操作, so that 快照語意在 live → terminal 只走一次的契約下保持一致。
24. As a 維護者, I want 三項功能共用既有 smoke 接縫與 fail-closed 斷言風格, so that 回歸防護不需要新測試框架。

## Implementation Decisions

1. **Gates 是註冊式 Pi Core tools，不是新引擎。** 新增一組 design gate tools（contrast/state-aware、console-error、build-success、token-consistency、responsive overflow），經既有 tool registry 註冊、capability admission 把關、在 critique stage 由 runner 呼叫。沿用 ADR-0048：gate 輸出才是 execution evidence；模型敘述不是。
2. **Evidence kind 擴充。** `SubDesignCritiqueEvidence.kind` 新增 `'gate'`；gate 證據記載 gate id、輸入參數摘要、輸出量測值、sha256。既有 kinds（lint/build/screenshot/dom/manual/template-attribution/asset-license）不動。
3. **Verdict fail-closed 規則落在 critique store。** Critique store 的 record 入口新增驗證：verdict 為 pass 時，四項分數各自必須有對應 gate 證據引用（score ↔ gate id 對應表），否則整筆 critique 拒絕記錄（回傳 errors，與現行 manifest invalid 同型）。此規則同時約束 design_critique tool 的輸出路徑。
4. **Pin 是 host 端功能，iframe 內容零信任。** Pin 模式的元素解析由 host 注入的唯讀 script 完成（與 ArtifactPreview CSP 注入同一機制）；payload 結構：element selector、region 座標、user text、artifact revision。提交前經 schema validation，信任等級與 MCP Apps bridge 相同。
5. **Pinned comment 編譯成結構化 follow-up input。** Workspace controller 的 followUp 新增結構化輸入形狀：pin 列表 + 目標 artifact (id:revision)。controller 將其組裝為 prompt context + patch intent，走既有 prepareRun → runTask。Patch 操作復用 `SubDesignArtifactPatchOperation`（path/find/replace/expectedMatches），以 pin 區域預先計算 scope，不做自由字串替換以外的全域改寫。
6. **Snapshot 落在 artifact store 的 register 路徑。** Artifact store 每次 register 成功時，將 entry + supportingFiles 寫入 per-revision 快照目錄並記錄 sha256 manifest。Restore = 以舊快照內容建立新 revision（歷史 append-only）。Diff = 讀兩份快照做逐檔文字比較，結果為 UI-ready 的結構化差異。
7. **Live guard。** Restore 與其他寫性操作在該 brief 的 run 為 live 時被 controller 拒絕（沿用 deriveRunLifecycle 的 live 判定），錯誤型別與現行 busy failure 同型。
8. **Schema changes 摘要**：critique evidence kind 新增 `'gate'`；artifact store 狀態新增 revisions 快照索引（revision → { files: {path, sha256}, createdAt }）；follow-up 輸入聯集新增 pinned-comment 形狀。皆為 additive，不破壞既有 persisted 資料（舊資料缺快照索引時視為無快照、restore 對該版停用但不報錯）。

## Testing Decisions

好的測試只斷言外部可觀察行為（store 回傳值、controller action result、smoke 對 shipped module 的合約），不測內部實作細節；本專案的 smoke 慣例（import shipped modules + source-text drift guards）就是這個標準。

- **Critique gates**：
  - Store-level：pass verdict 缺 gate 證據 → record 失敗且 errors 指明缺哪些 gate；帶齊 gate 證據 → 記錄成功且 evidence 含 'gate' 條目。先例：subdesign-workspace smoke 的 store 斷言風格。
  - Tool registry drift guard：gate tools 必須註冊且列於 critique stage 的允許集合。先例：smoke-tool-registry。
  - Fail-closed 文字守衛：「gate 未執行不得宣稱分數」的 prompt/capability 合約以 drift guard 固定。先例：既有 smokes 的 source-text guards。
- **Pinned comments**：
  - Controller-level：以 fake deps 注入（同 smoke-subdesign-workspace 的 dependencies() harness）斷言 pinned-comment followUp 產生恰好一次 runTask、prompt context 含 pin 結構、live 中拒絕。
  - 元件層 fixture：SubDesignUnified.fixture 模式驗證 pin UI 狀態流（idle → pinning → submitted）與提交摘要顯示。
  - Schema validation：畸形 payload 被拒絕且不觸發 run。
- **Revision snapshots**：
  - Store-level：register 後快照索引可查、sha256 正確；restore 產生新 revision 且內容等於目標快照；live brief 拒絕 restore；diff 回傳兩版的結構化差異。先例：artifact-index-handoff 類 smoke。
  - Persisted 相容性：無快照索引的舊 artifact 載入不炸、restore 對其停用。

## Out of Scope

- P1/P2 項目（見 research report）：react-component 可執行預覽契約、local-first review threads 完整 UI、self-hosted publish/share lane、DESIGN.md / DTCG tokens 外部匯入、stage-level eval fixtures。
- 雲端部署、公開分享 URL、語音留言轉文字。
- 平行方向分支（three-style exploration）。
- 任何新的執行迴圈、第二 orchestration layer、或讓 renderer/iframe 取得權限的設計。
- Critique panelist 數量、評分權重、美學判斷本身的改造——gates 證明客觀正確性；美感仍交給 taste audit 與人類 review。

## Further Notes

- 研究依據：Open CoDesign 的 Comment mode 與 boolean parity rubric、ux-ui-agent-skills 的 verification protocol、Glance 的留言迴路（留言一律正規化為文字）、Open Artifacts 的 immutable version 與 409 衝突語意、Dyad/Onlook 的 checkpoint 操作。各 repo 的授權與維護風險已在研究文件標註；本 spec 只借鑑行為語意，不引入任何上游程式碼或 runtime 依賴。
- Open CoDesign roadmap 自己還沒做 version snapshots + side-by-side diff——第 3 項做完即是相對競品的差異點。
- 成本對照（Dyad FAQ）：gates 是 deterministic 腳本，成本遠低於增加 agentic 迴圈；pinned-comment 迭代刻意收斂為單次 runTask。
