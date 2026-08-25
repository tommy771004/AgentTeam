# 18 — Settings 的 Git 偏好對正式回合完全沒有作用

**What to build:** Settings 上的 Git 偏好要嘛真的約束 agent 的行為，要嘛從 UI 移除。目前使用者可以設定它們，但在 Pi Host 的正式回合上不產生任何效果 —— 包含關閉 force push。

**Blocked by:** 無。

**Status:** 可交給代理

## 問題

`applyGitSettingsToBash`（`src/agent/tools/toolIoHelpers.ts:115`）會確定性地改寫 shell 指令：補上分支前綴、`gh pr create` 補 `--draft`，以及在 `gitForcePush` 關閉時**刪除** `--force` / `--force-with-lease`。

它現在**沒有任何呼叫者**。唯一的引用是 `src/agent/tools/executor.ts:14` 的 re-export，而 `executor.ts` 是個 compat shim，全 repo 無人 import。原本唯一的呼叫者是 `registered/bash.ts:38`，隨 ADR-0027 的 renderer 工具移除而一起消失。

**勸告層也不在這條路上**：`hermes/promptBuilder.ts:57-70` 會把 Git 偏好寫進 prompt，但 `buildPromptLayers` 唯一的呼叫者是 `useSlashExecutor.ts`（slash 指令路徑）。Pi Host 回合走 `piTurnContext.ts`，其 ContextPacket 只有 project guidance / recent chat / session recall，**沒有 Git 偏好**。

實質後果：使用者在 Settings 關閉「允許 force push」，agent 仍可執行 `git push --force`。`SettingsPage.tsx:1388-1410` 的三個控制項寫進的是無人讀取的設定。

## 為什麼要修

`piProduction.ts:38-45` 的註解已經記載過同一類錯誤：`toolsEnabled` 等欄位「were claimed by the Host, deleted from local storage, and then never sent anywhere — the Settings UI wrote them to nothing at all」。這次是「消費者被刪、UI 留著」，路徑不同結果相同。

## 驗收條件

- [x] 決定並記錄 Git 偏好的歸屬：Host 執行、prompt 勸告、或從 Settings 移除。三選一，不得同時宣稱又不實作。
- [x] 若選擇 Host 執行：偏好要有通道到達 Host。建議走 per-run 的 `RunContextPolicy`（與 ADR-0047 shell posture 同性質），而非 `PI_SETTINGS_FIELD_BY_KEY` 的持久 settings。
- [x] 改寫必須發生在 ADR-0047 gate **之前**，否則 gate 檢查的字串與實際執行的字串不一致。順序要用 smoke 釘住。
- [x] `--force` 的語意重新決定：靜默刪除旗標在 in-turn 攔截層會讓模型看到「成功但行為不同」。傾向改為 deny + reason，與 gate 一致。
- [ ] 若選擇移除：Settings UI、`LlmSettings` 欄位與 `DEFAULT_LLM_SETTINGS` 一併清掉，`applyGitSettingsToBash` 與 `executor.ts` 的 re-export 刪除。
- [x] Drift guard：每個 `LlmSettings` 欄位都必須能指到至少一個消費者，否則 build 失敗。這能一次擋掉這整類錯誤。
- [x] Qualification 以真實 Pi turn 證明所選語意（force push 被擋／被拒／不存在該設定）。

## Comments

### 決定：Host 執行，`--force` 拒絕而非改寫

三個選項中採「Host 執行」。`--force` 採**拒絕並說明理由**，不靜默移除旗標 —— 移除會產生一個可執行的指令，模型於是為一個沒有真正發生的 push 讀到成功。拒絕是誠實且可行動的；靜默改寫破壞性意圖兩者皆非。

兩類偏好因此分開處理：

- **加法型**（分支前綴、`--draft`）是**改寫**：補上使用者要的東西，不改變指令在做什麼。
- **禁止的 force push** 是**拒絕**。

### 實作

- `src/agent/tools/gitCommandPolicy.ts` — 純決策模組，回 `allow` / `rewrite` / `deny`。已加上前綴、已指定自己命名空間（`feature/x`）、以及 `git checkout main`（不是建分支）都不動；`rewrite` 因此永遠代表真的有東西改變了。
- 通道走 per-run `RunContextPolicy.gitPolicy`（與 ADR-0047 shell posture 同性質），在 `buildRunContextPolicy` 凍結，經 IPC 到 Host binding。**`allowForcePush` 嚴格讀取**：只有明確的 `true` 才放行，字串 `'true'`、`1`、`{}` 一律 false —— 唯一具破壞性的偏好 fail closed。
- 執行點在 `piToolHost` 的 bash `tool_call`，**排在 outbound shell gate 之前**，所以 gate 檢查與 sandbox 包裹的都是實際會執行的字串。順序由 smoke 釘住。
- `applyGitSettingsToBash` 與 `executor.ts` 的 re-export **已刪除**，只剩一個實作者。

### Drift guard（新增 Guard 6）

`check-pi-contract.mts` 現在掃 `DEFAULT_LLM_SETTINGS` 的每個欄位，要求它在宣告／預設／UI／store 以外至少有一個消費者。實測新增一個沒人讀的欄位 → build 失敗。

它同時抓出**另外 7 個早已孤兒化的欄位**：`llmRetryMaxAttempts`、`llmCircuitBreakerEnabled`、`llmParseEnabled`、`classificationEndpointUrl`、`classificationAllowPlaintextHttp`、`concurrentRunsEnabled`、`ambientSuggestions`。逐一確認皆為零消費者。

它們被列進 `KNOWN_UNCONSUMED_SETTINGS` —— **是列出，不是豁免**：守衛因此立刻對任何**新**漂移生效，不必等這 7 個各自的產品決定。並加了反向斷言：某個欄位一旦有了消費者就必須從清單移除，否則失敗，清單不會腐爛。追蹤於 issue 21。

### 真實 Pi turn qualification（已補）

`smoke-pi-git-preferences.mts` 現在 12 tests，最後四條由**真實 Pi turn**（loopback model + shipped Host）settle：

- 模型要求 `git push --force …` → Host 拒絕，理由指名 force push，且副作用檔不存在。
- 模型要求 `git checkout -b fix-login` → 工作區是**真的 git repo**，接著讓模型跑 `git rev-parse --abbrev-ref HEAD`，斷言分支名是 `agent/fix-login`。**由 git 自己說出實際建立了哪個分支** —— 這是唯一不會說謊的帳。

### 過程中確認的一件事：Turn Record 記的是「模型要求什麼」

原本我斷言 `tool-call` 的 args 會是改寫後的指令，失敗了。實際行為是：Pi 的 `tool_execution_start` 攜帶的是**Host patch 之前**的引數，所以記錄保留的是模型的請求。

改寫本身並沒有遺失 —— 它在 evidence trail 裡（`evidence.update(git.note)`）。兩者合起來才是誠實的帳：記錄說模型要求了什麼，evidence 說套用了哪個偏好。已把這個組合釘成斷言，而不是讓它是個巧合。

### 未打勾

- 「若選擇移除」不適用（採 Host 執行）。
