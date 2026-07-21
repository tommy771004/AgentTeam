# 11 — 建立 Managed Device Enrollment 與 HTTP Secure Envelope

**What to build:** 讓 Workspace 首次 authenticated enrollment 為每台電腦發出 opaque Managed Device ID 與獨立安全材料。當公司 Workspace 必須使用 HTTP 時，所有 enrollment、credential、evidence key、Policy Bundle 與 evidence payload 都包在具 replay protection 的 Workspace Secure Envelope 中，絕不以 plaintext control payload fallback。

**Blocked by:** 10 — 同步 Workspace 原子 Policy Bundle

**Status:** resolved

- [x] first authenticated enrollment 建立 immutable opaque device ID，不從 hostname、username、MAC、disk serial 或其他硬體/個資導出。
- [x] human-readable device label 與 identity 分離，改名不會改變 device ID 或 chain identity。
- [x] 每台裝置建立獨立 key pair 與 per-device evidence HMAC key；private/key material 不暴露給 renderer 或 project。
- [x] HTTPS Workspace 不強制 application envelope；HTTP Workspace 對所有 control/evidence payload 強制 envelope。
- [x] HTTP trust anchor 只接受 Electron main 啟動環境預置的 `SUBAGENTS_WORKSPACE_PUBLIC_KEYS`，policy、renderer 與 server response 無法修改。
- [x] key list 支援重疊 rotation；找不到匹配 key 時 HTTP Workspace 不可用。
- [x] endpoint origin 與完整 URL 被 pin，redirect 被拒絕。
- [x] envelope 使用標準 authenticated encryption、unique nonce/sequence 與 replay protection；tamper、replay、wrong-key payload 均拒絕。
- [x] decrypt/auth failure 只能使用仍合格的 last-known-good cache，不會把 body 當 plaintext JSON。
- [x] synthetic integration fixtures 驗證 enrollment、key rotation、replay denial、redirect denial 與 plaintext rejection。


## Answer

- `deviceEnrollment.ts`: opaque `mdv_*` ids, independent HMAC/envelope keys, label rename keeps id, AES-GCM envelope, nonce replay reject, `SUBAGENTS_WORKSPACE_PUBLIC_KEYS` parse, HTTP requires envelope.
- smoke-outbound-phase2.

