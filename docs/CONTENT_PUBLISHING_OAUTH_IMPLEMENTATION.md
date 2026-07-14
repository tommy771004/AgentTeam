# Content Publishing OAuth/API 實作狀態

## 已完成

- [x] Instagram、LinkedIn、X、Facebook、YouTube 五平台 provider contract 與 OAuth scope。
- [x] Electron main-process loopback OAuth；X/YouTube 使用 PKCE。
- [x] OAuth access token、refresh token 與 client credential 保存於 OS `safeStorage` vault。
- [x] Token 只經 main process 使用；renderer IPC 僅回傳連線 metadata 與發布結果。
- [x] 發布前檢查到期 Token，支援一般 OAuth refresh；Instagram 使用平台的 token refresh endpoint。
- [x] LinkedIn Posts API、X API v2、Facebook Page `/feed`、Instagram media container + `media_publish`、YouTube resumable upload。
- [x] ContentItem 媒體欄位：Instagram public image URL、YouTube local video path、Facebook Page ID、YouTube privacy status。
- [x] 缺少授權、設定或必要媒體時明確回傳失敗，不把排程當成已發布。
- [x] Production smoke 32 項、`tsc -b`、production build 通過。

## 啟用前設定

所有平台都要在平台開發者後台建立 OAuth App，並註冊固定回呼：

```text
http://127.0.0.1:19789/oauth/callback
```

Client ID 可在內容發布頁輸入，也可使用環境變數：

```text
CONTENT_PUBLISH_INSTAGRAM_CLIENT_ID
CONTENT_PUBLISH_INSTAGRAM_CLIENT_SECRET
CONTENT_PUBLISH_LINKEDIN_CLIENT_ID
CONTENT_PUBLISH_LINKEDIN_CLIENT_SECRET
CONTENT_PUBLISH_X_CLIENT_ID
CONTENT_PUBLISH_X_CLIENT_SECRET
CONTENT_PUBLISH_FACEBOOK_CLIENT_ID
CONTENT_PUBLISH_FACEBOOK_CLIENT_SECRET
CONTENT_PUBLISH_YOUTUBE_CLIENT_ID
CONTENT_PUBLISH_YOUTUBE_CLIENT_SECRET
META_GRAPH_VERSION             # 預設 v23.0
LINKEDIN_VERSION               # 預設 202607
```

## 尚待外部驗證

- [ ] 填入各平台正式 App credentials 並完成一次真實 OAuth 授權。
- [ ] 依平台審核/產品限制完成 Instagram Business/Creator、Facebook Page、LinkedIn `w_member_social`、X API access、YouTube API project verification。
- [ ] 以測試帳號完成五平台真實發布與 Token refresh；不得使用 production 帳號作為 smoke fixture。

## 官方 API 依據

- [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing)
- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [X OAuth 2.0](https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code)
- [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
