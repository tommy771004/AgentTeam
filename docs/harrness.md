有。以今天 2026-08-20 往前抓三個月，也就是約 2026-05-20 之後新建立的 GitHub repo，我找到幾個非常接近你要的：

| Repo                                                                                    |       建立時間 | 技術                             | 符合程度  |
| --------------------------------------------------------------------------------------- | ---------: | ------------------------------ | ----- |
| [Octo-Lex/ChatGPT-Web2API](https://github.com/Octo-Lex/ChatGPT-Web2API)                 | 2026-06-06 | Python + Chrome CDP            | ★★★★★ |
| [MrBalourd/chatgpt-api-web](https://github.com/MrBalourd/chatgpt-api-web)               | 2026-08-16 | Node.js + Playwright + Express | ★★★★★ |
| [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web)                 | 2026-07-26 | TypeScript + browser bridge    | ★★★★☆ |
| [yxhpy/chatgpt-pro-browser](https://github.com/yxhpy/chatgpt-pro-browser)               | 2026-06-23 | Python + Playwright            | ★★★★☆ |
| [mdonovan3/chatgpt-bridge](https://github.com/mdonovan3/chatgpt-bridge)                 | 2026-06-27 | Python + Selenium              | ★★★☆☆ |
| [lesterppo/hermes-chatgpt-web-cli](https://github.com/lesterppo/hermes-chatgpt-web-cli) | 2026-06-15 | Python + Playwright            | ★★★☆☆ |

其中最值得研究的是前 3 個。

**1. Octo-Lex/ChatGPT-Web2API — 最符合你描述的架構**

它幾乎就是：

```text
Your Web/App
     │
     │ POST /v1/chat/completions
     ▼
ChatGPT-Web2API
     │
     │ Chrome DevTools Protocol
     ▼
Chrome
     │
     ▼
chatgpt.com
     │
     │ prompt
     ▼
ChatGPT response
     │
     ▼
JSON / SSE
     │
     ▼
Your Web/App
```

README 明確寫的是：

> 「Turn ChatGPT into an API」，啟動 Chrome、登入 ChatGPT，然後提供 OpenAI-compatible API + MCP server。

甚至可以直接：

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model":"auto",
    "messages":[
      {"role":"user","content":"Hello"}
    ]
  }'
```

然後拿到：

```json
{
  "choices": [
    {
      "message": {
        "content": "..."
      }
    }
  ]
}
```

也就是你說的：

```text
request
   ↓
ChatGPT Web
   ↓
send prompt
   ↓
get response
   ↓
return response
```

它是 2026-06-06 建立，GitHub 資料顯示截至 2026-08-19 有更新，Python、21 stars、5 forks。

這個目前是我認為**最適合直接當你 AP Server 基底**的。

---

**2. MrBalourd/chatgpt-api-web — 跟你的 Node/TS Web 架構最接近**

這個更直接：

```text
React / Server
      │
      │ HTTP
      ▼
Express API
      │
      │ Playwright / CDP
      ▼
Chrome
      ▼
ChatGPT Web
```

它提供：

```text
POST /v1/chat/completions
GET  /v1/models
GET  /v1/conversations
GET  /health
```

而且支援：

* OpenAI-compatible response
* SSE streaming
* Playwright
* Chrome persistent profile
* conversation_id
* 真正 ChatGPT `/c/<id>` 的 chatgpt_id
* concurrent request queue

README 的架構就是：

```text
Your app
   │
   │ OpenAI-compatible HTTP
   ▼
chatgpt-api-web
   │
   │ Playwright / CDP
   ▼
Google Chrome
   │
   ▼
ChatGPT Web
```

它非常新，**2026-08-16 才建立**，JavaScript + Express + Playwright。

如果你希望自己改造成：

```text
React TypeScript
      ↓
AP Server
      ↓
Playwright
      ↓
ChatGPT Web
```

我反而會優先讀這個，因為比 Python 版本更接近你的技術棧。

---

**3. miuuyy/codex-chatgpt-web — 技術成熟度最高**

這個近期成長很快：

* 建立：2026-07-26
* 更新：2026-08-20
* TypeScript
* 約 **1,135 stars**
* 144 forks

架構是：

```text
Codex task
    │
    │ Responses + SSE
    ▼
codex-chatgpt-web
    │
    │ embedded browser
    ▼
ChatGPT Web
```

它已經處理很多你之後一定會碰到的問題：

* browser session
* streaming
* long context
* images
* cancellation
* UI selector drift
* MCP
* browser diagnostics
* concurrency
* session isolation
* Temporary Chat

但它的缺點是目前主要設計給 **Codex**，不是通用 AP Server。

所以比較適合作為「架構與 browser harness 參考」，而不是直接拿來當 REST backend。

---

**4. yxhpy/chatgpt-pro-browser**

它走真正 Playwright browser automation：

```text
Python / Agent
     ↓
Playwright
     ↓
Real Chrome
     ↓
chatgpt.com
     ↓
prompt
     ↓
assistant response
```

支援：

* prompt
* multi-turn
* file upload
* long response
* resume
* GPT Pro
* Python API

建立於 2026-06-23。

它沒有像 Web2API 那樣直接提供完整 REST server，但 Browser Harness 很值得拆來用。

---

**5. mdonovan3/chatgpt-bridge**

這個非常簡潔：

```python
with ChatGPTSession() as gpt:
    reply = gpt.send("Hello")
```

它直接：

> Send prompts to AI chat interfaces via browser automation, get responses back.

同時支援 ChatGPT / Gemini。

建立於 2026-06-27。

適合研究「最小可行 browser bridge」，但成熟度比前面三個低很多。

---

另外一個小型專案是 `hermes-chatgpt-web-cli`，使用 Playwright + persistent Chrome profile：

```text
--login
   ↓
Chrome
   ↓
保存 session
   ↓
Playwright
   ↓
prompt → response
```

建立於 2026-06-15。

你之前想做的：

```text
React TypeScript / Vercel
        │
        ▼
request
        │
        ▼
AP Server
        │
        ▼
Playwright
        │
        ▼
ChatGPT Web
        │
        ▼
response
        │
        ▼
JSON
        │
        ▼
React
```

現在其實已經有相當接近的現成實作了。以你的用途，我會把基底優先順序排成：

```text
① ChatGPT-Web2API
   │
   ├── API server 架構
   ├── OpenAI-compatible endpoint
   ├── CDP
   ├── MCP
   └── response streaming

② chatgpt-api-web
   │
   ├── Node / Express
   ├── Playwright
   ├── SSE
   └── 最容易整合 React/TypeScript

③ codex-chatgpt-web
   │
   ├── browser orchestration
   ├── session management
   ├── diagnostics
   ├── concurrency
   └── context management
```

如果要實際做你那套，我不會從零開始寫 Playwright；會以 **`ChatGPT-Web2API + chatgpt-api-web + codex-chatgpt-web` 三個 repo 的設計合併**，做成：

```text
POST /api/chat
      ↓
Request Queue
      ↓
Browser Session Manager
      ↓
Playwright/CDP
      ↓
ChatGPT Web
      ↓
Response Observer
      ↓
SSE / JSON
      ↓
React
```

這會比原本「每次 GitHub Action 啟一個 Playwright」穩定很多，尤其登入 session、Cloudflare、長時間 response 與 browser profile 都需要持久化。
