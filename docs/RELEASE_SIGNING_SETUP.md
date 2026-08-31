# Release signing 與更新通道設定手冊

> 適用專案：AgentStudio / AgentTeam
> 對應 workflow：`.github/workflows/release.yml`  
> 最後查核：2026-08-31

本文件說明如何取得並設定 `Release evidence` workflow 所需的 GitHub
Environment secrets 與 variables。平台簽章憑證來自 Microsoft/公開 CA 或 Apple，
更新金鑰由發行者自行保管。`package` job 只使用簽章用的 `release-signing`
Environment；客戶通道的發布網址與 token 必須隔離在 `release-publishing`，目前 workflow
尚未引用它們。

## 0. 先讀：不要用跳過簽章來修 #35

Release evidence #35 的 Windows、macOS x64、macOS arm64 job 都通過 build、smoke
與 security gates，最後分別停在：

- Windows：`Verify Windows signing configuration`
- macOS：`Verify macOS signing configuration`

目前 workflow 使用 `environment: release-signing`，並以 `forceCodeSigning=true`、
Authenticode、Gatekeeper 與 notarization 證據 fail-closed。不要填假值、使用自簽憑證、
刪除驗證步驟，或把失敗改成 `continue-on-error`。

## 1. 完成前檢查表

### `release-signing` Environment secrets

| 名稱 | 來源 | 值格式 |
|---|---|---|
| `WINDOWS_CSC_LINK` | 既有 Windows code-signing 憑證 | base64 `.pfx/.p12`、HTTPS URL 或檔案路徑；GitHub runner 建議 base64 |
| `WINDOWS_CSC_KEY_PASSWORD` | 匯出 PFX/P12 時設定 | 憑證容器密碼 |
| `WINDOWS_PUBLISHER_THUMBPRINT` | Windows 簽章憑證 | SHA-1 thumbprint，不含空格或冒號 |
| `MACOS_CSC_LINK` | Apple Developer ID Application 憑證 | base64 `.p12` |
| `MACOS_CSC_KEY_PASSWORD` | 匯出 P12 時設定 | 憑證容器密碼 |
| `APPLE_ID` | Apple Developer 帳號 | Apple Account 電子郵件 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple Account 網站 | app-specific password，不是登入密碼 |
| `APPLE_TEAM_ID` | Apple Developer Membership | 10 字元 Team ID |
| `UPDATE_PRIVATE_KEY` | AgentStudio 更新簽章金鑰 | PEM PKCS#8 RSA 私鑰；必須匹配 app 內建公鑰 |

### `release-signing` Environment variables

| 名稱 | 用途 | 範例形狀，不是真實值 |
|---|---|---|
| `UPDATE_BASE_URL` | 客戶端公開下載根網址 | `https://updates.example.com/beta` |

`UPDATE_BASE_URL` 後面不要加 `/win32/x64` 或 `/darwin/arm64`；workflow 會自行附加
平台與架構路徑。

### `release-publishing` Environment（保留給 Ticket 03）

客戶通道的 `UPDATE_PUBLISH_TOKEN` secret 與 `UPDATE_PUBLISH_URL` variable 必須放在獨立、
保護更嚴格的 `release-publishing` Environment。Ticket 02 的 workflow 不引用此 Environment，
因此 qualification 前的 package job 無法取得發布 credential，也不能寫入客戶更新通道。

## 2. 建立 GitHub `release-signing` Environment

需要 repository owner 或 admin 權限。GitHub 官方說明：Environment secrets 只會提供給
引用該 Environment 的 job，而且需先通過該 Environment 的 protection rules。

1. 開啟 repository。
2. 進入 **Settings → Environments**。
3. 如果沒有 `release-signing`，點 **New environment**。
4. 名稱輸入 `release-signing`，大小寫與 workflow 保持完全一致。
5. 建議在 **Deployment branches and tags** 只允許 `v*` tags。
6. 若設定 required reviewers，發版時必須先核准，job 才能取得 secrets。
7. 在 **Environment secrets** 加入上表九個簽章 secrets。
8. 在 **Environment variables** 加入 `UPDATE_BASE_URL`。
9. 另建 `release-publishing` Environment，設定更嚴格的 required reviewers；可預先加入
   `UPDATE_PUBLISH_TOKEN` 與 `UPDATE_PUBLISH_URL`，但目前不得讓任何 job 引用它。
10. 若 repository 曾依舊版手冊設定發布 credential，從 `release-signing` 刪除
    `UPDATE_PUBLISH_TOKEN` secret 與 `UPDATE_PUBLISH_URL` variable；只新增副本不足以完成
    ownership migration。

官方文件：

- [Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [Secrets reference](https://docs.github.com/en/actions/reference/security/secrets)

GitHub secrets 最大 48 KB。Environment secret 會在引用該 Environment 的 job 啟動時
讀取，因此補完設定後可以 rerun #35，不需要重建 tag。

## 3. Windows 簽章：先選方案

### 3.1 重要限制

自 2023-06-01 起，公開信任 code-signing certificate 的私鑰必須由合規硬體或雲端
HSM 保護。因此，新購憑證通常不再提供可自由匯出的 PFX。參考
[CA/Browser Forum Code Signing Baseline Requirements](https://cabforum.org/working-groups/code-signing/requirements/)。

目前 repository 的 Windows workflow 只接受 `WINDOWS_CSC_LINK` +
`WINDOWS_CSC_KEY_PASSWORD` 的檔案式 PFX/P12。請依下列情況選擇：

- **已有合法、未過期、可匯出的 PFX/P12**：可直接使用 3.2。
- **從零申請新憑證**：建議 Azure Artifact Signing 或 CA 的 cloud/HSM signing。
  這些服務不會交付 `WINDOWS_CSC_LINK`，必須先修改 workflow 的 Windows signing
  backend，不能把 Azure client secret 當成 PFX 填入現有欄位。
- **USB token**：GitHub-hosted runner 無法接觸你的實體 token，不適合目前 workflow；
  需自架 runner 或改採 cloud signing。

Microsoft 目前將 Azure Trusted Signing 更名為 **Artifact Signing**，並推薦它作為
Microsoft Store 外 Windows app 的 code-signing 方案：

- [Windows code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Artifact Signing overview](https://learn.microsoft.com/en-us/azure/artifact-signing/overview)
- [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Artifact Signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)

Artifact Signing Public Trust 有國家/地區資格限制。申請前請以 quickstart 的即時清單
確認公司法定所在地是否支援。若不支援，需選擇支援硬體或 remote signing 的公開 CA，
再為該服務調整 workflow。

### 3.2 已有 PFX/P12 時取得三個值

#### A. 確認憑證用途與期限

在 Windows PowerShell 執行：

```powershell
$cert = Get-PfxCertificate -FilePath C:\secure\subagents-code-signing.pfx
$cert | Format-List Subject, Issuer, Thumbprint, NotBefore, NotAfter, EnhancedKeyUsageList
```

確認：

- certificate chain 為公開信任 CA，不是 self-signed；
- Enhanced Key Usage 包含 Code Signing；
- 尚未過期或撤銷；
- Subject/Publisher 是預期的發行者名稱。

#### B. 設定 `WINDOWS_PUBLISHER_THUMBPRINT`

使用上一步輸出的 `Thumbprint`，移除空白與冒號後存入 GitHub。例如只保留：

```text
0123456789ABCDEF0123456789ABCDEF01234567
```

不要把憑證序號、Subject 名稱或 SHA-256 檔案雜湊誤當成 thumbprint。

#### C. 設定 `WINDOWS_CSC_LINK`

不要把 `.pfx` 放進 repository。以 PowerShell 產生單行 base64：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure\subagents-code-signing.pfx')) |
  Set-Clipboard
```

把剪貼簿內容存為 `WINDOWS_CSC_LINK`。electron-builder 接受 base64、HTTPS URL 或檔案
路徑；GitHub-hosted runner 最直接的是 base64。Windows environment variable 有約 8192
字元限制；如果 PFX base64 超出限制，請依 electron-builder 說明重新匯出且不要包含
不必要的完整中繼 chain，或改用 cloud signing。

#### D. 設定 `WINDOWS_CSC_KEY_PASSWORD`

使用 PFX/P12 匯出時設定的強密碼。不要使用 Windows 登入密碼，也不要把密碼放在
YAML、`.env`、命令列參數、issue 或文件中。

electron-builder 官方參考：

- [Code Signing](https://www.electron.build/docs/features/code-signing/)
- [Code Signing for Windows](https://www.electron.build/docs/features/code-signing/code-signing-win/)

## 4. macOS Developer ID 與 notarization

### 4.1 先決條件

1. 加入付費 [Apple Developer Program](https://developer.apple.com/programs/)。
2. Apple Account 開啟 two-factor authentication。
3. 一般 Developer ID certificate 需由 Account Holder 建立；若採 cloud-managed
   Developer ID，Admin 還必須取得對應的 cloud-managed certificate access 權限。
4. Mac 安裝目前支援的 Xcode command-line tools，workflow 使用 `notarytool`，不要再用
   已淘汰的 `altool`。

Apple 官方說明：

- [Developer ID](https://developer.apple.com/support/developer-id/)
- [Create Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Signing your apps for Gatekeeper](https://developer.apple.com/developer-id/)
- [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

### 4.2 建立 `Developer ID Application` certificate

可使用 Xcode 或 Developer portal。Portal 流程：

1. 登入 [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)。
2. 點新增 certificate。
3. 選 **Developer ID Application**。本專案輸出 `.app` 與 `.dmg`，不是 Mac App Store
   Distribution，也不是 Developer ID Installer PKG certificate。
4. 依頁面指示用 Keychain Access 產生 Certificate Signing Request（CSR）。
5. 上傳 CSR、下載 certificate，雙擊匯入產生 CSR 的同一台 Mac。
6. 在 Keychain Access → **My Certificates** 展開 certificate，確認下方存在 private key。
   只有 certificate 沒有 private key 時無法簽章。

### 4.3 匯出 `MACOS_CSC_LINK` 與密碼

1. 在 Keychain Access 的 **My Certificates** 選取 Developer ID Application certificate
   與其 private key。
2. **File → Export Items**，格式選 Personal Information Exchange (`.p12`)。
3. 設定一組新的強密碼；它就是 `MACOS_CSC_KEY_PASSWORD`。
4. 將 P12 轉為單行 base64 並直接複製到剪貼簿：

```bash
base64 -i /secure/path/SubAgents-Developer-ID.p12 | tr -d '\n' | pbcopy
```

5. 把剪貼簿內容存為 `MACOS_CSC_LINK`。
6. 安全刪除不再需要的暫存匯出檔，正式備份放在存取受控的密碼庫或離線媒體。

### 4.4 取得 `APPLE_ID`

填入加入 Apple Developer team、可執行 notarization 的 Apple Account 電子郵件。不要填
App Store 上的產品 ID、bundle ID 或 Team ID。

### 4.5 建立 `APPLE_APP_SPECIFIC_PASSWORD`

1. 登入 [account.apple.com](https://account.apple.com/)。
2. 進入 **Sign-In and Security → App-Specific Passwords**。
3. 建立一組只供 `AgentStudio GitHub notarization` 使用的密碼。
4. 立即複製，存為 `APPLE_APP_SPECIFIC_PASSWORD`。

這不是 Apple Account 主密碼。重設 Apple Account 主密碼會撤銷既有 app-specific
passwords。官方說明：[Using app-specific passwords](https://support.apple.com/102654)。

### 4.6 取得 `APPLE_TEAM_ID`

1. 登入 [Apple Developer Account](https://developer.apple.com/account/)。
2. 進入 **Membership details**。
3. 複製 10 字元 **Team ID**，存為 `APPLE_TEAM_ID`。

不要使用 App Store Connect issuer ID、certificate serial number 或 bundle seed ID。

### 4.7 在本機驗證 notarization 帳號

避免把密碼直接寫進 shell history，使用 `notarytool` 的互動式 keychain profile：

```bash
xcrun notarytool store-credentials "subagents-notary" \
  --apple-id "your-apple-id@example.com" \
  --team-id "YOURTEAMID"

xcrun notarytool history --keychain-profile "subagents-notary"
```

第一個命令會互動要求 app-specific password。官方參考：
[Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。

## 5. 更新簽章金鑰 `UPDATE_PRIVATE_KEY`

### 5.1 先判斷原私鑰是否存在

`UPDATE_PRIVATE_KEY` 不是任意 RSA 私鑰。CI 會從私鑰導出 public key，並要求它和
`app/electron/updatePublicKey.ts` 的 `BUILT_IN_UPDATE_PUBLIC_KEY` 完全一致。

目前內建 public key 無法反推出 private key。先搜尋公司的密碼庫、離線備份、原發版機
或原 GitHub Environment secret 的來源紀錄：

- 找得到原 private key：使用 5.2 驗證後上傳。
- 找不到，而且尚未對外散布任何信任目前 public key 的版本：可依 5.3 建立新 key pair，
  再更新程式內 public key。
- 找不到，但已有客戶端信任目前 public key：這是正式 key-loss 事件。不能直接換 key；
  舊客戶端會拒絕新 manifest。需要設計以舊 key 授權新 key 的 rotation release，或提供
  經 OS 簽章驗證的手動升級路徑。

### 5.2 驗證既有 private key

不要印出私鑰。從安全路徑讀入單一 process environment 執行 repo 的驗證器：

```bash
cd app
UPDATE_PRIVATE_KEY="$(< /secure/path/update-private.pem)" \
  node --experimental-strip-types scripts/verify-update-signing-key.mts
```

成功訊息應為 `Update signing key matches packaged trust root`。若出現
`does not match the packaged update trust root`，不要上傳該私鑰。

上傳時直接從檔案讀 stdin，避免貼到命令列：

```bash
gh secret set UPDATE_PRIVATE_KEY --env release-signing < /secure/path/update-private.pem
```

### 5.3 僅限建立全新信任根時產生 key pair

```bash
umask 077
openssl genpkey -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -out /secure/path/update-private.pem
openssl pkey \
  -in /secure/path/update-private.pem \
  -pubout \
  -out /secure/path/update-public.pem
```

接著必須把 `update-public.pem` 的完整 PEM 內容更新到
`app/electron/updatePublicKey.ts`，完成 build/smoke、code review 與 release evidence。
私鑰永遠不能加入 Git。更新 manifest 與 artifact 使用 RSA-SHA256；實作見
`app/scripts/build-update-manifest.mjs`。

## 6. 建立更新發布服務（Ticket 03 前不由 workflow 呼叫）

### 6.1 這三個值從哪裡來

`UPDATE_BASE_URL`、`UPDATE_PUBLISH_URL`、`UPDATE_PUBLISH_TOKEN` 不是 Apple、Microsoft
或 GitHub 配發。你必須先建立一個 HTTPS object storage + upload API，或其他符合下列
契約的發布服務。

目前 workflow **不執行遠端 PUT**。每個 package matrix job 只把已簽章的 candidate
manifest 與 installers 上傳到私有 GitHub Actions artifact storage；qualification 失敗時，
不會產生客戶通道 publication request。

Ticket 03 的 publish owner 完成後，預定使用下列介面：

```http
PUT {UPDATE_PUBLISH_URL}/{platform}/{arch}/manifest.json
Authorization: Bearer {UPDATE_PUBLISH_TOKEN}
```

並以相同方式 PUT `.exe`、`.dmg` 等 artifact。客戶端則匿名 GET：

```http
GET {UPDATE_BASE_URL}/{platform}/{arch}/manifest.json
GET {UPDATE_BASE_URL}/{platform}/{arch}/{encoded-artifact-name}
```

目前平台/架構組合：

- `win32/x64`
- `darwin/x64`
- `darwin/arm64`

### 6.2 必要行為

發布服務必須：

1. 僅接受 HTTPS。
2. PUT 端要求 Bearer token，匿名使用者不可上傳或覆寫。
3. GET 端允許 app 下載 manifest 與 artifact。
4. 保留 Content-Length、二進位內容與檔名，不得轉碼。
5. 支援至少 1 GB artifact，或配合 app 的下載上限調整。
6. 對舊版本保留 rollback/evidence 所需物件，不要在新發版時直接清空 bucket。
7. 記錄 uploader、時間、物件 hash 與失敗回應，但不得記錄 Bearer token。

本專案預設客戶端 URL 是：

```text
https://updates.subagents.ai/beta/{platform}/{arch}/manifest.json
```

若沿用此網域，`UPDATE_BASE_URL` 應設成 `https://updates.subagents.ai/beta`，並確保 DNS、
TLS 與儲存服務已真正部署。`UPDATE_PUBLISH_URL` 可以是不同的私有 upload endpoint，
但其最終物件必須能由 `UPDATE_BASE_URL` 指向的公開 URL 取得。

### 6.3 建立 token

在你選定的發布服務建立最小權限 credential：

- 只能寫入 Beta update prefix；
- 不應具有 account admin、刪除整個 bucket、DNS 或 billing 權限；
- 設定到期日或固定輪替週期；
- token 存為 `UPDATE_PUBLISH_TOKEN`；
- 發現外洩時先撤銷，再建立新 token 並更新 GitHub secret。

如果服務只支援 S3/R2 presigned URL、AWS SigV4 或其他認證，不能直接填現有 token；
必須增加相容的 upload gateway，或修改 workflow 的 publish step。

## 7. 使用 GitHub UI 或 CLI 寫入設定

### 7.1 UI

在 **Settings → Environments → release-signing**：

- **Environment secrets → Add secret**：加入九個簽章 secrets。
- **Environment variables → Add variable**：加入 `UPDATE_BASE_URL`。

發布 credential 只能加入 **Settings → Environments → release-publishing**，且在 Ticket 03
的 qualification-bound publish owner 完成前，不要讓 workflow job 引用該 Environment。
若舊值仍存在於 `release-signing`，在各項目右側選單按 **Delete** 移除。

GitHub 不允許重新讀取 secret 明文。新增前先在安全位置備份；更新後只會看到名稱與
最近更新時間。

### 7.2 GitHub CLI

先登入並確認 repository：

```bash
gh auth login
gh repo set-default tommy771004/AgentTeam
```

一般文字 secret 會互動要求輸入，不要將值放進 command argument：

```bash
gh secret set APPLE_ID --env release-signing
gh secret set APPLE_APP_SPECIFIC_PASSWORD --env release-signing
gh secret set APPLE_TEAM_ID --env release-signing
gh secret set MACOS_CSC_KEY_PASSWORD --env release-signing
gh secret set WINDOWS_CSC_KEY_PASSWORD --env release-signing
gh secret set WINDOWS_PUBLISHER_THUMBPRINT --env release-signing
```

從檔案或 pipe 上傳大型 secret：

```bash
base64 -i /secure/path/SubAgents-Developer-ID.p12 | tr -d '\n' |
  gh secret set MACOS_CSC_LINK --env release-signing

gh secret set UPDATE_PRIVATE_KEY --env release-signing \
  < /secure/path/update-private.pem
```

Windows certificate 建議在 Windows PowerShell 轉 base64 後，以 GitHub UI 加入；不要將
base64 落到 repository 內的檔案。

設定 variables：

```bash
gh variable set UPDATE_BASE_URL \
  --env release-signing \
  --body 'https://updates.subagents.ai/beta'

gh secret set UPDATE_PUBLISH_TOKEN --env release-publishing
gh variable set UPDATE_PUBLISH_URL \
  --env release-publishing \
  --body 'https://YOUR-UPLOAD-ENDPOINT.example/beta'

# 舊版設定遷移：package job 使用的 environment 不得保留發布 credential
gh secret delete UPDATE_PUBLISH_TOKEN --env release-signing
gh variable delete UPDATE_PUBLISH_URL --env release-signing
```

只檢查名稱，不會顯示 secret 值：

```bash
gh secret list --env release-signing
gh variable list --env release-signing
gh secret list --env release-publishing
gh variable list --env release-publishing
```

## 8. 發版前驗證

### 8.1 名稱完整性

`gh secret list --env release-signing` 應包含：

```text
APPLE_APP_SPECIFIC_PASSWORD
APPLE_ID
APPLE_TEAM_ID
MACOS_CSC_KEY_PASSWORD
MACOS_CSC_LINK
UPDATE_PRIVATE_KEY
WINDOWS_CSC_KEY_PASSWORD
WINDOWS_CSC_LINK
WINDOWS_PUBLISHER_THUMBPRINT
```

`gh variable list --env release-signing` 應包含：

```text
UPDATE_BASE_URL
```

`release-publishing` 可預先包含 `UPDATE_PUBLISH_TOKEN` 與 `UPDATE_PUBLISH_URL`，但目前
workflow 不會讀取。`release-signing` 的兩份清單必須確認沒有這兩個名稱；不要把它們
複製回 `release-signing`。

### 8.2 本機安全檢查

```bash
cd app
npm run smoke:release
npm run build
```

不要嘗試在沒有正式憑證的本機把 `forceCodeSigning` 改成 false。Windows Authenticode 與
macOS notarization 的最終證據必須由對應 GitHub runner 產生。

### 8.3 修復 #35 後重跑

```bash
gh run rerun 32356529844 --failed
gh run watch 32356529844 --exit-status
```

或在 [Release evidence #35](https://github.com/tommy771004/AgentTeam/actions/runs/32356529844)
頁面點 **Re-run failed jobs**。

成功順序應為：

1. signing configuration 通過；
2. electron-builder 強制簽章；
3. Windows Authenticode 或 macOS codesign/Gatekeeper/notarization/stapler 通過；
4. update private key 與內建 public key 匹配；
5. signed candidate manifest 與 installers 上傳到 GitHub Actions artifact storage；
6. 三個 matrix job、release gate、Paid Beta qualification、release ready 全部通過；
7. 客戶通道 publication 在 Ticket 03 完成前維持不可用。

## 9. 常見錯誤

| 錯誤 | 原因 | 處理 |
|---|---|---|
| `CSC_LINK is required` | secret 不在 `release-signing`、名稱錯誤或 protection 尚未核准 | 檢查 Environment secret 名稱與 deployment approval |
| `No identity found for code signing` | P12 沒有 private key、憑證類型錯誤或已過期 | 由原 CSR Mac 重新匯出 Developer ID Application certificate + private key |
| `CSSMERR_TP_CERT_REVOKED` | Apple certificate 已撤銷 | 建立新 certificate、更新 secret，不要繞過驗證 |
| notarization `401` | Apple ID、Team ID 或 app-specific password 不匹配 | 以本機 `notarytool store-credentials` 驗證並重建專用密碼 |
| `Unexpected publisher certificate` | `WINDOWS_PUBLISHER_THUMBPRINT` 與實際 signer 不同 | 從正式 PFX/簽後檔案重新取得 thumbprint，先確認不是憑證遭替換 |
| Windows base64 太長 | PFX 包含不必要 chain，超過環境變數限制 | 重新匯出或改採 cloud signing backend |
| `UPDATE_PRIVATE_KEY does not match` | 使用了另一把私鑰 | 找回原私鑰或啟動正式 key rotation，不要覆寫 public key 假裝通過 |
| publish owner HTTP `401/403` | token 無效、過期或 scope 不足 | 以最小權限重建 token，確認 PUT path policy |
| publish owner HTTP `405` | endpoint 不接受 PUT | 部署 upload gateway 或修改 publish integration |
| app GET manifest `404` | public base URL 與 publish storage 路徑未對齊 | 對照 `beta/{platform}/{arch}/manifest.json` 實際物件路徑 |

electron-builder troubleshooting：
[Troubleshooting](https://www.electron.build/docs/troubleshooting/)。

## 10. 輪替與事故處理

### 每 90 天檢查

- Windows/macOS certificate 到期日與撤銷狀態。
- Apple app-specific password 是否仍有效。
- 發布 token 的權限、使用紀錄與到期日。
- GitHub Environment admin、reviewers 與允許 tags。
- update private key 備份是否可用；只做完整性驗證，不把 key 複製到一般工作機。

### 憑證正常續期

1. 在到期前申請新 certificate。
2. 在隔離環境測試簽章與驗證。
3. 更新對應 GitHub secrets 與 Windows thumbprint。
4. rerun release evidence，保留新舊 certificate serial/thumbprint 的稽核紀錄。
5. 確認新簽章發版成功後，再依 CA/Apple 規則處理舊 certificate。

### 私鑰或 token 疑似外洩

1. 暫停 release workflow 與更新發布權限。
2. 立即撤銷發布 token；code-signing key 外洩則聯絡 CA、Apple 或 Microsoft 撤銷。
3. 檢查最近 signing transactions、GitHub Actions 與 object storage audit logs。
4. 建立新憑證/token，更新 GitHub secrets。
5. 對 update signing key 採正式 rotation/incident plan，不可只換內建 public key。
6. 記錄事件、影響版本、hash、處理人與恢復證據。

## 11. 不可做的事

- 不要 commit `.pfx`、`.p12`、`.pem`、app-specific password 或 token。
- 不要把 secret 放入 workflow `env:` 常值、npm script、issue、PR、聊天截圖或 release log。
- 不要在命令列直接寫密碼，因為可能進 shell history 或 process list。
- 不要用 self-signed certificate 取代公開信任發行憑證。
- 不要為了通過 CI 關掉 `forceCodeSigning`、notarization、timestamp 或 update signature。
- 不要把同一個發布 token 給日常開發、CI 與人工操作共同使用。
- 不要在尚未設計相容升級路徑前輪替 update trust root。

## 12. 專案內對應位置

- `.github/workflows/release.yml`：簽章、公證、candidate artifact 與 qualification 契約；
  Ticket 02 不包含客戶通道發布。
- `app/package.json`：electron-builder 的 macOS hardened runtime/notarize 與 Windows NSIS 設定。
- `app/electron/updatePublicKey.ts`：package 內建更新 public trust root。
- `app/scripts/verify-update-signing-key.mts`：private/public key 配對檢查。
- `app/scripts/build-update-manifest.mjs`：RSA-SHA256 manifest/artifact signature 與 URL 產生。
- `app/electron/updateManager.ts`：預設公開更新 URL 與下載後驗章。
