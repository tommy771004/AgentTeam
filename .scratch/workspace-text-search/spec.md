# 工作區文字檢索（Workspace Text Search）

> 狀態：`可交給代理`

## Problem Statement

在 Pi 生產路徑上工作的模型找不到「搜尋」工具：它無法用關鍵字找程式碼位置，只能整檔 read 或繞道 shell。對使用者而言，這代表每次「幫我找 XX 在哪」都燒掉大量不必要的 token 與時間——而同一套 grep/glob 能力其實早已存在於應用程式裡（renderer seam 的 `workspace_grep` / `workspace_glob` 定義、Electron main 的工作區搜尋 helper、IPC 與 smoke 都在），只是依 ADR-0028 擁有生產工具目錄的 Pi Core Host 看不到它。

## Solution

提供一個可選擇開啟的「工作區文字檢索」模式：使用者在 設定 → 一般 打開開關（預設關閉）後，Pi 迴圈的模型獲得 `workspace_grep` / `workspace_glob` 兩個唯讀搜尋工具，以 Host Extension Pack 工具的身分走既有漸進式揭露機制；關閉時這兩個工具對模型完全不存在——不進目錄、tool_search 搜不到、執行（含 `run_code` 巢狀）回結構化失敗並指向設定位置（fail-closed）。本 effort 所有改動都遵循這一個開關。

## User Stories

1. As a task conversation user, I want 在設定的一般分頁有一個「工作區文字檢索」開關（預設關閉）, so that 我自己決定要不要讓模型取得搜尋工具.
2. As a task conversation user, I want 開啟開關後模型能用關鍵字搜尋專案檔案, so that 找東西不再整檔閱讀燒 token.
3. As a task conversation user, I want 模型能用 glob 樣式列檔案, so that 「專案裡有哪些測試檔」一步就有答案.
4. As a task conversation user, I want 開關關閉時模型完全看不到這兩個工具, so that 我的工具面維持我熟悉的樣子.
5. As a task conversation user, I want 中途切換開關只影響之後的 run, so that 進行中的任務不會半途改變能力.
6. As a task conversation user, I want 大量搜尋結果自動被截斷/落地, so that 一次失控的搜尋不會撐爆 context.
7. As a security-conscious user, I want 搜尋永遠限制在工作區根內且唯讀, so that 開啟新模式不增加寫入或逃逸風險.
8. As a security-conscious user, I want 搜尋跳過 .git 與 node_modules 且不讀超大檔, so that 結果乾淨且快速.
9. As a plain-browser 使用者, I want 既有瀏覽器降級路徑行為不變, so that 開關只治理新增的 Host 面.
10. As a developer, I want 開關狀態遵循既有三點編輯設定契約, so that 設定持久化/合併/匯出不需特例.
11. As a developer, I want 一支 pack 層級 smoke 同時驗證 gating 與搜尋行為, so that 接縫只有一個、證據一 hop 可查.
12. As a developer, I want drift guard 防止有人繞過開關直接註冊工具, so that fail-closed 語意不隨時間腐爛.
13. As a reviewer, I want 開關 OFF 時連 `run_code` 巢狀呼叫也失敗, so that 「關閉」是真的關閉.
14. As a maintainer, I want 本 effort 不動凍結的 renderer seam 檔案集, so that 既有契約煙霧保持綠燈.

## Implementation Decisions

- **架構定位**：新工具是 Host Extension Pack 工具（ADR-0028/0031），掛進現有 Workspace Extras pack 或同目錄新 pack；在 capabilities 目錄宣告 owning capability（歸 `workspace` 家族），使漸進式揭露（deferLoading / `load_capability` / `tool_search`）機制原樣適用。
- **名稱沿用** `workspace_grep` / `workspace_glob`；依 ADR-0027 宣告為 renderer seam 同名工具的行為等價取代（Pi 路徑由 Host 版本服務），renderer 凍結檔案集零改動。
- **後端重用**：執行邏輯完全重用 Electron main 既有的工作區搜尋 helper（含目錄 skip、大小上限、結果上限與 truncated 語意）；不引入新二進位依賴。
- **總開關（本 effort 的治理核心）**：`LlmSettings` 新增 boolean 欄位（預設 `false`），Settings → 一般 分頁呈現開關；UI 文案繁中混英。設定值隨既有 settings 快照路徑進 Host；pack 工具是否加入 session 目錄在 session runtime 建立時評估——OFF 時：不進目錄、tool_search 不可見、execute 回結構化失敗（內容說明未啟用並指向設定位置）、巢狀（`run_code`）同樣被拒。Run 以送出當下的快照為準，中途切換下一 run 才生效。
- **安全不變量**：兩工具皆唯讀 operationClass；路徑解析不得離開工作區根（越界回 typed 失敗）；approval 矩陣、Outbound Data Gate、supervisor payload 上限/spill 全部照常適用，無任何新豁免。
- **誠實語意**：拒絕訊息必須說明「此模式未啟用」（指向設定位置），絕不假裝搜尋無結果。

## Testing Decisions

- 只測外部行為：給定設定快照 + fixture 目錄樹，斷言目錄成員資格、envelope 形狀、匹配/截斷/skip 語意、gating 三態（目錄缺席／搜尋不可見／執行拒絕）。不測內部實作細節。
- 測試模組：Extension Pack 建構/執行單元（唯一新接縫），以設定快照參數化；設定欄位預設值與 UI 接線沿用既有 source-text drift guard 模式。
- Prior art：pack 工具煙霧（fake ctx 直呼 execute 斷言 jsonOk/structuredFailure）、workspace-search smoke 的 mkdtemp fixture 目錄樹與 ripgrep argv 前綴斷言、既有 settings 欄位的預設值/合併 guard。

## Out of Scope

- context-usage-panel、pruning 反抖動、retry-from-checkpoint 入口、eval harness（各自獨立 effort）。
- LSP / 語意搜尋 / code index 檢索；ripgrep 二進位捆綁升級。
- renderer 凍結 seam 的任何修改；外部 CLI runner 的工具面。
- 開關的多層級設定（per-role / per-thread override）。

## Further Notes

- 原始動機來自 DeepSeek harness 比較文件的 P1#6 建議；該文件寫作時 renderer 路徑已實作，本 effort 補的是生產路徑與治理開關。
- 開關預設關閉是刻意保守：先讓模式存在且可驗證，再談預設開啟。
- 票依賴為純線性鏈 01←02←03←04：02 必須等 01，因為「所有改動遵循開關」要求工具進生產路徑的第一天就受治理。
