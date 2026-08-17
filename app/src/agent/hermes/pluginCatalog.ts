import type { PluginManifest } from './plugins.ts'
import {
  asanaConnectorTools,
  canvaConnectorTools,
  clickupConnectorTools,
  connectorManifest,
  dropboxConnectorTools,
  figmaConnectorTools,
  githubConnectorTools,
  googleCalendarTools,
  homeAssistantConnectorTools,
  linearConnectorTools,
  notionConnectorTools,
  sheetsConnectorTools,
} from './connectorTools.ts'

export type PluginCatalogCategory = 'Featured' | 'Productivity' | 'Creativity'
export type PluginInstallKind = 'bundled' | 'npm-mcp' | 'connector'

/** How the user authorizes a connector after install. */
export type PluginAuthSpec = {
  /** pat/api_key = paste token; oauth = open provider page then paste token/code */
  type: 'pat' | 'api_key' | 'oauth'
  label: string
  placeholder?: string
  /** Help / create-token docs */
  docsUrl?: string
  /**
   * Browser authorize URL. May include {client_id} placeholder;
   * for local desktop we primarily use docs + PAT paste (no client secret required).
   */
  authorizeUrl?: string
  scopes?: string[]
}

export interface PluginCatalogItem {
  id: string
  name: string
  description: string
  category: PluginCatalogCategory
  icon: string
  accent: string
  installKind: PluginInstallKind
  featured?: boolean
  tags?: string[]
  setupHint?: string
  /** simple-icons slug key without `si` prefix, e.g. `Github` → siGithub */
  brandIcon?: string
  auth?: PluginAuthSpec
  npm?: {
    packageName: string
    packageSpec: string
    binName: string
    args: string[]
    requiresProjectRoot?: boolean
    /**
     * Link MCP process to connector secrets (pluginSecrets / customToolSecrets).
     * mcpServers[].pluginId will be set to this so env injection works.
     */
    secretPluginId?: string
    /** Env keys to reserve for secret injection (defaults from MCP_SECRET_ENV_KEYS) */
    envKeys?: string[]
  }
  /** Prefer installing this connector first (shown in marketplace tips) */
  dependsOnPluginId?: string
  manifest?: Omit<PluginManifest, 'id' | 'name' | 'enabled'>
}

const skill = (
  name: string,
  description: string,
  body: string,
  tags: string[],
) => ({
  path: `plugins/${name}/SKILL.md`,
  raw: `---\nname: ${name}\ndescription: ${description}\nversion: 1.0.0\nauthor: SubAgents AI\ncreatedBy: user\ntags: [${tags.join(', ')}]\n---\n\n${body.trim()}\n`,
})

export const PLUGIN_CATALOG: PluginCatalogItem[] = [
  {
    id: 'filesystem-mcp',
    name: 'Workspace Files',
    description: 'Read, search, and organize files in approved project folders.',
    category: 'Featured',
    icon: 'folder_open',
    brandIcon: 'Files',
    accent: '#4C8DFF',
    installKind: 'npm-mcp',
    featured: true,
    tags: ['MCP', 'files', 'workspace'],
    npm: {
      packageName: '@modelcontextprotocol/server-filesystem',
      packageSpec: '@modelcontextprotocol/server-filesystem@2026.7.10',
      binName: 'mcp-server-filesystem',
      args: ['${projectRoot}'],
      requiresProjectRoot: true,
    },
  },
  {
    id: 'github-mcp',
    name: 'GitHub MCP',
    description: 'Official MCP server for GitHub API — issues, PRs, repos (uses GitHub connector token).',
    category: 'Featured',
    icon: 'code',
    brandIcon: 'Github',
    accent: '#24292F',
    installKind: 'npm-mcp',
    featured: true,
    tags: ['MCP', 'GitHub', 'PR', 'API'],
    setupHint: '請先安裝並授權「GitHub」connector，token 會自動注入 MCP 環境變數。',
    dependsOnPluginId: 'github-connector',
    npm: {
      packageName: '@modelcontextprotocol/server-github',
      packageSpec: '@modelcontextprotocol/server-github@2025.4.8',
      binName: 'mcp-server-github',
      args: [],
      secretPluginId: 'github-connector',
      envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOKEN'],
    },
  },
  {
    id: 'notion-mcp',
    name: 'Notion MCP',
    description: 'Official Notion MCP server (local) — pages, data sources, markdown tools.',
    category: 'Featured',
    icon: 'description',
    brandIcon: 'Notion',
    accent: '#FFFFFF',
    installKind: 'npm-mcp',
    featured: true,
    tags: ['MCP', 'Notion', 'docs', 'wiki'],
    setupHint: '請先安裝並授權「Notion」connector；NOTION_TOKEN 會自動注入。',
    dependsOnPluginId: 'notion-connector',
    npm: {
      packageName: '@notionhq/notion-mcp-server',
      packageSpec: '@notionhq/notion-mcp-server@2.4.1',
      binName: 'notion-mcp-server',
      args: [],
      secretPluginId: 'notion-connector',
      envKeys: ['NOTION_TOKEN', 'NOTION_API_KEY'],
    },
  },
  {
    id: 'figma-mcp',
    name: 'Figma MCP',
    description: 'Community Figma MCP — view nodes, comments (uses Figma connector token).',
    category: 'Creativity',
    icon: 'design_services',
    brandIcon: 'Figma',
    accent: '#A259FF',
    installKind: 'npm-mcp',
    tags: ['MCP', 'Figma', 'design'],
    setupHint: '請先授權「Figma」connector；FIGMA_API_KEY 會自動注入。',
    dependsOnPluginId: 'figma-connector',
    npm: {
      packageName: 'figma-mcp',
      packageSpec: 'figma-mcp@0.1.4',
      binName: 'figma-mcp',
      args: [],
      secretPluginId: 'figma-connector',
      envKeys: ['FIGMA_API_KEY', 'FIGMA_ACCESS_TOKEN', 'FIGMA_PERSONAL_ACCESS_TOKEN'],
    },
  },
  {
    id: 'brave-search-mcp',
    name: 'Brave Search MCP',
    description: 'Official MCP web/local search via Brave Search API.',
    category: 'Featured',
    icon: 'travel_explore',
    accent: '#FB542B',
    installKind: 'npm-mcp',
    featured: true,
    tags: ['MCP', 'search', 'web', 'brave'],
    setupHint: '在設定 → 外掛 OAuth 或市集授權「Brave Search」後注入 BRAVE_API_KEY。',
    dependsOnPluginId: 'brave-search',
    npm: {
      packageName: '@modelcontextprotocol/server-brave-search',
      packageSpec: '@modelcontextprotocol/server-brave-search@0.6.2',
      binName: 'mcp-server-brave-search',
      args: [],
      secretPluginId: 'brave-search',
      envKeys: ['BRAVE_API_KEY'],
    },
  },
  {
    id: 'puppeteer-mcp',
    name: 'Puppeteer MCP',
    description: 'Official MCP browser automation via Puppeteer (screenshots, navigate, click).',
    category: 'Featured',
    icon: 'public',
    brandIcon: 'Googlechrome',
    accent: '#4285F4',
    installKind: 'npm-mcp',
    tags: ['MCP', 'browser', 'puppeteer', 'automation'],
    npm: {
      packageName: '@modelcontextprotocol/server-puppeteer',
      packageSpec: '@modelcontextprotocol/server-puppeteer@2025.5.12',
      binName: 'mcp-server-puppeteer',
      args: [],
    },
  },
  {
    id: 'postgres-mcp',
    name: 'PostgreSQL MCP',
    description: 'Official read-only PostgreSQL MCP — schema inspect + SQL query.',
    category: 'Productivity',
    icon: 'storage',
    accent: '#336791',
    installKind: 'npm-mcp',
    tags: ['MCP', 'postgres', 'sql', 'database'],
    setupHint: '請先安裝「Postgres DSN」connector 並貼上連線字串；執行時替換 ${secret}。',
    dependsOnPluginId: 'postgres-dsn',
    npm: {
      packageName: '@modelcontextprotocol/server-postgres',
      packageSpec: '@modelcontextprotocol/server-postgres@0.6.2',
      binName: 'mcp-server-postgres',
      args: ['${secret}'],
      secretPluginId: 'postgres-dsn',
      envKeys: ['POSTGRES_CONNECTION_STRING', 'DATABASE_URL'],
    },
  },
  {
    id: 'memory-mcp',
    name: 'Memory MCP',
    description: 'Official MCP knowledge-graph memory server for durable entity notes.',
    category: 'Productivity',
    icon: 'psychology',
    accent: '#8B5CF6',
    installKind: 'npm-mcp',
    tags: ['MCP', 'memory', 'graph'],
    npm: {
      packageName: '@modelcontextprotocol/server-memory',
      packageSpec: '@modelcontextprotocol/server-memory@2026.7.4',
      binName: 'mcp-server-memory',
      args: [],
    },
  },
  {
    id: 'sequential-thinking-mcp',
    name: 'Sequential Thinking MCP',
    description: 'Official MCP server for structured multi-step reasoning chains.',
    category: 'Productivity',
    icon: 'account_tree',
    accent: '#14B8A6',
    installKind: 'npm-mcp',
    tags: ['MCP', 'reasoning', 'planning'],
    npm: {
      packageName: '@modelcontextprotocol/server-sequential-thinking',
      packageSpec: '@modelcontextprotocol/server-sequential-thinking@2026.7.4',
      binName: 'mcp-server-sequential-thinking',
      args: [],
    },
  },
  {
    id: 'web-reader',
    name: 'Web Reader',
    description: 'Fetch public pages, RSS feeds, and JSON APIs for the agent.',
    category: 'Featured',
    icon: 'language',
    brandIcon: 'Googlechrome',
    accent: '#1DBF73',
    installKind: 'bundled',
    featured: true,
    tags: ['web', 'research', 'RSS'],
    manifest: {
      version: '1.0.0',
      description: 'Public web and RSS reader with approval-aware HTTP access.',
      promptAppend: '需要讀取使用者提供的公開 URL 時，優先使用 web_reader_fetch，並清楚標示來源。',
      skills: [
        skill(
          'web-reader-workflow',
          '公開網頁與 RSS 的來源整理流程。',
          '# Web Reader\n\n1. 確認 URL 為公開來源。\n2. 使用 `web_reader_fetch` 擷取內容。\n3. 區分原文事實與代理推論。\n4. 在結果中保留來源 URL。',
          ['web', 'research'],
        ),
      ],
      customTools: [
        {
          name: 'web_reader_fetch',
          description: 'Fetch a public URL as text for research and extraction.',
          kind: 'http_template',
          template: { method: 'GET', url: '{{url}}' },
          params: {
            url: { type: 'string', description: 'Public http/https URL', required: true },
          },
          requiresApproval: true,
        },
      ],
    },
  },
  {
    id: 'spreadsheets-connector',
    name: 'Spreadsheets',
    description: 'Create and edit spreadsheet files.',
    category: 'Featured',
    icon: 'table_chart',
    brandIcon: 'Googlesheets',
    accent: '#0F9D58',
    installKind: 'connector',
    featured: true,
    tags: ['sheets', 'data'],
    setupHint: '貼上 Google 服務帳戶或 OAuth access token（Sheets scope）。',
    auth: {
      type: 'oauth',
      label: 'Google Sheets access token',
      placeholder: 'ya29.… 或服務帳戶 JSON 中的 private key 流程取得的 token',
      docsUrl: 'https://developers.google.com/sheets/api/guides/authorizing',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fspreadsheets&response_type=token&include_granted_scopes=true',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    },
    manifest: connectorManifest(
      'spreadsheets-connector',
      'Spreadsheets',
      sheetsConnectorTools(),
      'Sheets 已授權：用 gsheets_get_values 讀取範圍；寫入前須使用者確認。',
    ),
  },
  {
    id: 'presentations-connector',
    name: 'Presentations',
    description: 'Create and edit presentations.',
    category: 'Featured',
    icon: 'slideshow',
    brandIcon: 'Googleslides',
    accent: '#F4B400',
    installKind: 'connector',
    featured: true,
    tags: ['slides', 'docs'],
    setupHint: '貼上 Google Slides scope 的 access token。',
    auth: {
      type: 'oauth',
      label: 'Google Slides access token',
      docsUrl: 'https://developers.google.com/slides/api/guides/authorizing',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fpresentations&response_type=token&include_granted_scopes=true',
    },
  },
  {
    id: 'data-toolkit',
    name: 'Data Analytics',
    description: 'Answer product and business questions from structured data.',
    category: 'Featured',
    icon: 'analytics',
    brandIcon: 'Googleanalytics',
    accent: '#7B6CFF',
    installKind: 'bundled',
    featured: true,
    tags: ['data', 'JSON', 'table'],
    manifest: {
      version: '1.0.0',
      description: 'Structured-data analysis workflow using built-in parsing tools.',
      promptAppend: '分析結構化資料時先驗證欄位、缺值與資料型態，再提出結論。',
      skills: [
        skill(
          'data-analysis-workflow',
          'JSON 與表格資料的可驗證分析流程。',
          '# Data Analytics\n\n1. 讀取資料並記錄來源。\n2. 使用 `json_extract_lite` 或 `table_parse` 解析。\n3. 檢查缺值、重複值與型態。\n4. 將事實、計算與推論分開輸出。',
          ['data', 'analytics'],
        ),
      ],
    },
  },
  {
    id: 'github-connector',
    name: 'GitHub',
    description: 'Triage PRs, issues, CI, and publish flows.',
    category: 'Featured',
    icon: 'code',
    brandIcon: 'Github',
    accent: '#24292F',
    installKind: 'connector',
    featured: true,
    tags: ['GitHub', 'PR', 'CI'],
    setupHint: '建立 fine-grained 或 classic PAT（repo / workflow 依需求）。',
    auth: {
      type: 'pat',
      label: 'GitHub Personal Access Token',
      placeholder: 'ghp_… 或 github_pat_…',
      docsUrl: 'https://github.com/settings/tokens',
      authorizeUrl: 'https://github.com/settings/tokens/new',
      scopes: ['repo', 'read:org'],
    },
    manifest: connectorManifest(
      'github-connector',
      'GitHub',
      githubConnectorTools(),
      'GitHub 已授權：優先使用 github_whoami / github_list_issues / github_list_prs；寫入操作仍須使用者明確要求與核准。',
    ),
  },
  {
    id: 'git-workspace',
    name: 'Git Workspace',
    description: 'Inspect the active branch, working tree, and recent commits.',
    category: 'Featured',
    icon: 'account_tree',
    brandIcon: 'Git',
    accent: '#F1502F',
    installKind: 'bundled',
    tags: ['git', 'developer'],
    manifest: {
      version: '1.0.0',
      description: 'Approval-gated Git workspace inspection tools.',
      skills: [
        skill(
          'git-workspace-review',
          '檢查 Git 工作樹與近期變更。',
          '# Git Workspace\n\n先執行唯讀狀態檢查，再依使用者要求分析差異；未獲授權不得 commit、push 或重寫歷史。',
          ['git', 'developer'],
        ),
      ],
      customTools: [
        {
          name: 'git_workspace_status',
          description: 'Show the active branch and concise working-tree status.',
          kind: 'bash_template',
          template: { command: 'git status --short --branch' },
          params: {},
          requiresApproval: true,
        },
        {
          name: 'git_recent_commits',
          description: 'Show the ten most recent commits.',
          kind: 'bash_template',
          template: { command: 'git log -10 --oneline --decorate' },
          params: {},
          requiresApproval: true,
        },
      ],
    },
  },
  {
    id: 'browser-connector',
    name: 'Browser Control',
    description: 'Drive browser tabs and capture page context with approval.',
    category: 'Featured',
    icon: 'public',
    brandIcon: 'Googlechrome',
    accent: '#4285F4',
    installKind: 'connector',
    tags: ['browser', 'chrome'],
    setupHint: '提供本機橋接端點 token 或擴充元件配對碼。',
    auth: {
      type: 'api_key',
      label: 'Browser bridge token',
      placeholder: 'bridge_…',
      docsUrl: 'https://developer.chrome.com/docs/extensions',
    },
  },
  {
    id: 'notion-connector',
    name: 'Notion',
    description: 'Notion workflows for specs, research, and team wikis.',
    category: 'Productivity',
    icon: 'description',
    brandIcon: 'Notion',
    accent: '#FFFFFF',
    installKind: 'connector',
    tags: ['Notion', 'docs'],
    setupHint: '建立 Notion integration 並複製 Internal Integration Secret。',
    auth: {
      type: 'api_key',
      label: 'Notion Integration Secret',
      placeholder: 'ntn_… 或 secret_…',
      docsUrl: 'https://www.notion.so/my-integrations',
      authorizeUrl: 'https://www.notion.so/my-integrations',
    },
    manifest: connectorManifest(
      'notion-connector',
      'Notion',
      notionConnectorTools(),
      'Notion 已授權：用 notion_search / notion_get_page 讀取整合可存取的頁面；不可捏造未取回的內容。',
    ),
  },
  {
    id: 'calendar-connector',
    name: 'Google Calendar',
    description: 'Manage Google Calendar events and reminders.',
    category: 'Productivity',
    icon: 'calendar_month',
    brandIcon: 'Googlecalendar',
    accent: '#4285F4',
    installKind: 'connector',
    tags: ['calendar', 'Google'],
    setupHint: '貼上 Calendar scope 的 OAuth access token。',
    auth: {
      type: 'oauth',
      label: 'Google Calendar access token',
      docsUrl: 'https://developers.google.com/calendar/api/auth',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar&response_type=token&include_granted_scopes=true',
      scopes: ['https://www.googleapis.com/auth/calendar'],
    },
    manifest: connectorManifest(
      'calendar-connector',
      'Google Calendar',
      googleCalendarTools(),
      'Calendar 已授權：用 gcal_list_calendars / gcal_list_events；建立事件前須使用者確認。',
    ),
  },
  {
    id: 'linear-connector',
    name: 'Linear',
    description: 'Plan and build products with issue sync.',
    category: 'Productivity',
    icon: 'task_alt',
    brandIcon: 'Linear',
    accent: '#5E6AD2',
    installKind: 'connector',
    tags: ['Linear', 'issues'],
    setupHint: 'Linear Settings → API → Personal API keys。',
    auth: {
      type: 'api_key',
      label: 'Linear API key',
      placeholder: 'lin_api_…',
      docsUrl: 'https://linear.app/settings/api',
      authorizeUrl: 'https://linear.app/settings/api',
    },
    manifest: connectorManifest(
      'linear-connector',
      'Linear',
      linearConnectorTools(),
      'Linear 已授權：用 linear_viewer / linear_list_issues 查詢；變更 issue 前須確認。',
    ),
  },
  {
    id: 'clickup-connector',
    name: 'ClickUp',
    description: 'Automate projects, docs, and reports.',
    category: 'Productivity',
    icon: 'flag',
    brandIcon: 'Clickup',
    accent: '#7B68EE',
    installKind: 'connector',
    tags: ['ClickUp', 'projects'],
    setupHint: 'ClickUp Settings → Apps → API Token。',
    auth: {
      type: 'api_key',
      label: 'ClickUp API token',
      placeholder: 'pk_…',
      docsUrl: 'https://app.clickup.com/settings/apps',
      authorizeUrl: 'https://app.clickup.com/settings/apps',
    },
    manifest: connectorManifest(
      'clickup-connector',
      'ClickUp',
      clickupConnectorTools(),
      'ClickUp 已授權：用 clickup_user / clickup_list_teams / clickup_list_tasks。',
    ),
  },
  {
    id: 'dropbox-connector',
    name: 'Dropbox',
    description: 'Access, save, and share files.',
    category: 'Productivity',
    icon: 'cloud',
    brandIcon: 'Dropbox',
    accent: '#0061FF',
    installKind: 'connector',
    tags: ['Dropbox', 'files'],
    setupHint: 'Dropbox App Console 產生 access token。',
    auth: {
      type: 'oauth',
      label: 'Dropbox access token',
      docsUrl: 'https://www.dropbox.com/developers/apps',
      authorizeUrl: 'https://www.dropbox.com/developers/apps',
    },
    manifest: connectorManifest(
      'dropbox-connector',
      'Dropbox',
      dropboxConnectorTools(),
      'Dropbox 已授權：用 dropbox_list_folder 列目錄；寫入/刪除須使用者明確要求。',
    ),
  },
  {
    id: 'homeassistant-connector',
    name: 'Home Assistant',
    description: '控制區網智慧家庭：查 entity、開關燈/插座/場景（需 Long-Lived Token）。',
    category: 'Featured',
    icon: 'home',
    brandIcon: 'Homeassistant',
    accent: '#18BCF2',
    installKind: 'connector',
    featured: true,
    tags: ['Home Assistant', 'smart home', '區網', 'IoT'],
    setupHint:
      '在 HA → 個人資料 → 長期存取權杖 建立 token。工具參數 base_url 填 http://homeassistant.local:8123 或區網 IP。寫入操作一律需核准。',
    auth: {
      type: 'api_key',
      label: 'Home Assistant Long-Lived Token',
      placeholder: 'eyJ…（長期存取權杖）',
      docsUrl: 'https://www.home-assistant.io/docs/authentication/',
      authorizeUrl: 'https://www.home-assistant.io/docs/authentication/#your-account-profile',
    },
    manifest: connectorManifest(
      'homeassistant-connector',
      'Home Assistant',
      homeAssistantConnectorTools(),
      'Home Assistant 已授權：先 ha_api_status 驗證；查狀態用 ha_get_state / ha_list_states；控制用 ha_call_service（domain/service/entity_id）。門鎖、車庫、警報等危險操作必須先向使用者確認。base_url 預設 http://homeassistant.local:8123。',
    ),
  },
  {
    id: 'asana-connector',
    name: 'Asana',
    description: 'Turn chats into actions and project tasks.',
    category: 'Productivity',
    icon: 'checklist',
    brandIcon: 'Asana',
    accent: '#F06A6A',
    installKind: 'connector',
    tags: ['Asana', 'tasks'],
    setupHint: 'Asana Developer Console 建立 Personal Access Token。',
    auth: {
      type: 'pat',
      label: 'Asana Personal Access Token',
      docsUrl: 'https://app.asana.com/0/developer-console',
      authorizeUrl: 'https://app.asana.com/0/developer-console',
    },
    manifest: connectorManifest(
      'asana-connector',
      'Asana',
      asanaConnectorTools(),
      'Asana 已授權：用 asana_me / asana_workspaces / asana_tasks。',
    ),
  },
  {
    id: 'canva-connector',
    name: 'Canva',
    description: 'Access brand kits and shareable design assets.',
    category: 'Creativity',
    icon: 'draw',
    brandIcon: 'Canva',
    accent: '#00C4CC',
    installKind: 'connector',
    tags: ['Canva', 'design'],
    setupHint: 'Canva Connect 取得 API 憑證後貼上 access token。',
    auth: {
      type: 'oauth',
      label: 'Canva access token',
      docsUrl: 'https://www.canva.com/developers/',
      authorizeUrl: 'https://www.canva.com/developers/',
    },
    manifest: connectorManifest(
      'canva-connector',
      'Canva',
      canvaConnectorTools(),
      'Canva 已授權：用 canva_user 驗證 token；其他操作依 Connect API 範圍。',
    ),
  },
  {
    id: 'figma-connector',
    name: 'Figma',
    description: 'Read design files, nodes, and asset metadata.',
    category: 'Creativity',
    icon: 'design_services',
    brandIcon: 'Figma',
    accent: '#A259FF',
    installKind: 'connector',
    tags: ['Figma', 'design'],
    setupHint: 'Figma Settings → Security → Personal access tokens。',
    auth: {
      type: 'pat',
      label: 'Figma Personal Access Token',
      placeholder: 'figd_…',
      docsUrl: 'https://www.figma.com/developers/api#access-tokens',
      authorizeUrl: 'https://www.figma.com/developers/api#access-tokens',
    },
    manifest: connectorManifest(
      'figma-connector',
      'Figma',
      figmaConnectorTools(),
      'Figma 已授權：用 figma_me / figma_get_file 讀取設計檔；勿外洩檔案內容。',
    ),
  },
  {
    id: 'midjourney-connector',
    name: 'Image Studio',
    description: 'Generate and iterate on visual concepts for product work.',
    category: 'Creativity',
    icon: 'image',
    accent: '#FF6B6B',
    installKind: 'connector',
    tags: ['image', 'creative'],
    setupHint: '貼上圖像生成 API 金鑰（OpenAI / 相容供應商）。',
    auth: {
      type: 'api_key',
      label: 'Image API key',
      placeholder: 'sk-…',
      docsUrl: 'https://platform.openai.com/api-keys',
    },
  },
  {
    id: 'adobe-connector',
    name: 'Adobe Creative',
    description: 'Bridge design exports and creative cloud assets.',
    category: 'Creativity',
    icon: 'palette',
    brandIcon: 'Adobe',
    accent: '#FF0000',
    installKind: 'connector',
    tags: ['Adobe', 'design'],
    setupHint: 'Adobe Developer Console 專案 client credentials / access token。',
    auth: {
      type: 'oauth',
      label: 'Adobe access token',
      docsUrl: 'https://developer.adobe.com/console',
      authorizeUrl: 'https://developer.adobe.com/console',
    },
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'API key for Brave Search MCP (web + local search).',
    category: 'Featured',
    icon: 'travel_explore',
    accent: '#FB542B',
    installKind: 'connector',
    tags: ['Brave', 'search', 'API'],
    setupHint: 'https://api.search.brave.com/app/keys 產生 BRAVE_API_KEY。',
    auth: {
      type: 'api_key',
      label: 'Brave Search API Key',
      placeholder: 'BSA…',
      docsUrl: 'https://brave.com/search/api/',
      authorizeUrl: 'https://api.search.brave.com/app/keys',
    },
    manifest: {
      version: '1.0.0',
      description: 'Stores Brave Search API key for Brave Search MCP.',
      promptAppend:
        'Brave Search 金鑰已就緒：優先透過 Brave Search MCP（brave_web_search）做公開網路檢索。',
    },
  },
  {
    id: 'postgres-dsn',
    name: 'Postgres DSN',
    description: 'PostgreSQL connection string for read-only Postgres MCP.',
    category: 'Productivity',
    icon: 'storage',
    accent: '#336791',
    installKind: 'connector',
    tags: ['postgres', 'sql', 'database'],
    setupHint: '貼上 postgresql://user:pass@host:5432/db （唯讀帳號為佳）。',
    auth: {
      type: 'api_key',
      label: 'PostgreSQL connection string',
      placeholder: 'postgresql://…',
      docsUrl: 'https://www.postgresql.org/docs/current/libpq-connect.html',
    },
    manifest: {
      version: '1.0.0',
      description: 'Stores Postgres DSN for Postgres MCP server args.',
      promptAppend:
        'Postgres DSN 已就緒：透過 PostgreSQL MCP 做唯讀 schema/query；禁止寫入或 DDL。',
    },
  },
]

export function catalogItem(id: string) {
  return PLUGIN_CATALOG.find((item) => item.id === id)
}

