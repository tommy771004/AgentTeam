# 05 — Telegram／Webhook vault migration

**What to build:** 讓使用者可照常設定、啟動、旋轉與清除 Telegram／Webhook credentials，但 runtime 只從 main-process vault 取得 raw values，renderer 只投影設定狀態。

**Blocked by:** 04 — Credential vault expand contract。

**Status:** resolved

- [x] Telegram 與 Webhook 的新 save/rotate/clear flow 全部經 vault typed intents。
- [x] App restart 與 integration auto-start 從 vault reference 取得 credential，不再讀 legacy raw fields。
- [x] Settings UI 顯示 configured/token hint 與 safe-storage failure，不回傳或重填 raw token。
- [x] Migration smoke 覆蓋既有 raw settings、重跑冪等、vault write failure 與成功後移除 legacy raw fields。
- [x] Renderer payload、localStorage、settings export 與 Turn Record 的 negative assertions 均找不到測試 token。

## Comments

2026-08-31 — Telegram/Webhook migration 實作完成，完整 smoke qualification 執行中。

- [Main migration owner](../../../app/electron/integrationCredentialMigration.ts) 對 disk/localStorage/import 舊資料採 vault-first verification，已有 Vault record 優先；完成後才移除舊欄位。Disk scrub 使用 temporary file + rename；write/read/parse failure 保留原始資料且不在錯誤中回傳內容。
- [Renderer migration ingress](../../../app/src/agent/integrationCredentialSettings.ts) 是唯一轉送舊 localStorage 憑證的入口。Settings hydration、save、export 都不投影 raw values；遷移失敗保留唯一舊 copy、顯示錯誤及重試入口，不允許其他 save 蓋掉原始資料。
- [Settings credential field](../../../app/src/components/IntegrationCredentialField.tsx) 僅用 ephemeral password draft 提交 typed store/rotate/clear，不回填 Vault 值；顯示 configured/hint、安全儲存失敗及重新整理狀態。Clear 成功後不重啟缺憑證的 integration。
- [Telegram gateway](../../../app/electron/messagingGateway.ts) 與 [Webhook receiver](../../../app/electron/webhookServer.ts) 僅用 stable main Vault reference；Webhook status 不含 Token，入站 headers 排除驗證資訊，缺憑證／clear 後仍 fail closed。Telegram API 錯誤不反射 credential URL；poll、getFile、附件 download 都可取消。Auto-start 等待 migration readiness。
- Pi [message_send pack](../../../app/electron/piExtensionPacks/integrations.ts) 透過既有 Host service transport 委派 main gateway；不再持有 Telegram env token，main fork 也不傳該舊環境變數。Model arguments 不能指定執行憑證。
- Gate evidence：[smoke-integration-credential-migration.mts](../../../app/scripts/smoke-integration-credential-migration.mts) 經 `smoke` → `smoke:release` → `smoke:credential-vault` 執行。覆蓋 shipped main adapter、真實本機 HTTP receiver、Pi pack/service payload、附件取消、disk restart/write failure、實際 settingsStore hydration/update/export、localStorage retry 與 canary negative assertions。OS keychain、Telegram network、IPC/Storage 僅在系統邊界使用 fixture，不宣稱真機 Telegram 或 OS keychain qualification。
- [Credential ownership guard](../../../app/scripts/smoke-credential-vault-contract.mts) 保持 Pi resources／Turn Record owners 不得讀 raw Vault；[side-effect guard](../../../app/scripts/smoke-side-effect-evidence.mts) 已指向 main service authority，未放寬 tool approval 或 delivery-evidence 規則。
- Focused credential、side-effect、caps（91/91）、Pi contract、tracker-links、build/typecheck 與 scoped oxlint 通過。雙軸 review 的 startup race、附件取消、clear UI 誤報、write-failure fixture 四項已修復並複查。
- #06 custom-tool migration 與 #07 flat schema/default/legacy contract deletion 尚未執行；本票不宣稱全部 integration credential migration 收口。Paid Beta 維持 NO-GO。
