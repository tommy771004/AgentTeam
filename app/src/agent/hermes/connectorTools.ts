/**
 * Real declarative tools for marketplace connectors.
 * Secrets resolve via {{secret:<pluginId>}} → pluginSecrets / customToolSecrets.
 */
import type { CustomToolDefinition } from '../types'
import type { PluginManifest } from './plugins'

function httpGet(
  name: string,
  description: string,
  url: string,
  secretKey: string,
  params: CustomToolDefinition['params'] = {},
  extraHeaders?: Record<string, string>,
): CustomToolDefinition {
  return {
    name,
    description,
    kind: 'http_template',
    requiresApproval: true,
    template: {
      method: 'GET',
      url,
      headers: {
        Authorization: `Bearer {{secret:${secretKey}}}`,
        Accept: 'application/json',
        ...(extraHeaders || {}),
      },
    },
    params,
  }
}

/** GitHub REST helpers */
export function githubConnectorTools(pluginId = 'github-connector'): CustomToolDefinition[] {
  return [
    httpGet(
      'github_whoami',
      'Return the authenticated GitHub user (validates the stored token).',
      'https://api.github.com/user',
      pluginId,
      {},
      { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SubAgents-AI' },
    ),
    httpGet(
      'github_list_issues',
      'List issues for owner/repo (open by default).',
      'https://api.github.com/repos/{{owner}}/{{repo}}/issues?state={{state}}&per_page=20',
      pluginId,
      {
        owner: { type: 'string', description: 'GitHub org or user', required: true },
        repo: { type: 'string', description: 'Repository name', required: true },
        state: { type: 'string', description: 'open | closed | all (default open)', required: false },
      },
      { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SubAgents-AI' },
    ),
    httpGet(
      'github_list_prs',
      'List pull requests for owner/repo.',
      'https://api.github.com/repos/{{owner}}/{{repo}}/pulls?state={{state}}&per_page=20',
      pluginId,
      {
        owner: { type: 'string', description: 'GitHub org or user', required: true },
        repo: { type: 'string', description: 'Repository name', required: true },
        state: { type: 'string', description: 'open | closed | all', required: false },
      },
      { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SubAgents-AI' },
    ),
    httpGet(
      'github_get_issue',
      'Get a single issue by number.',
      'https://api.github.com/repos/{{owner}}/{{repo}}/issues/{{number}}',
      pluginId,
      {
        owner: { type: 'string', description: 'Owner', required: true },
        repo: { type: 'string', description: 'Repo', required: true },
        number: { type: 'string', description: 'Issue number', required: true },
      },
      { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SubAgents-AI' },
    ),
  ]
}

export function notionConnectorTools(pluginId = 'notion-connector'): CustomToolDefinition[] {
  return [
    {
      name: 'notion_search',
      description: 'Search Notion pages/databases the integration can access.',
      kind: 'http_template',
      requiresApproval: true,
      template: {
        method: 'POST',
        url: 'https://api.notion.com/v1/search',
        headers: {
          Authorization: `Bearer {{secret:${pluginId}}}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: '{"query":"{{query}}","page_size":10}',
      },
      params: {
        query: { type: 'string', description: 'Search query', required: true },
      },
    },
    httpGet(
      'notion_get_page',
      'Retrieve a Notion page by id.',
      'https://api.notion.com/v1/pages/{{page_id}}',
      pluginId,
      { page_id: { type: 'string', description: 'Notion page UUID', required: true } },
      { 'Notion-Version': '2022-06-28' },
    ),
  ]
}

export function linearConnectorTools(pluginId = 'linear-connector'): CustomToolDefinition[] {
  return [
    {
      name: 'linear_viewer',
      description: 'Return the authenticated Linear viewer (validates API key).',
      kind: 'http_template',
      requiresApproval: true,
      template: {
        method: 'POST',
        url: 'https://api.linear.app/graphql',
        headers: {
          Authorization: `{{secret:${pluginId}}}`,
          'Content-Type': 'application/json',
        },
        body: '{"query":"{ viewer { id name email } }"}',
      },
      params: {},
    },
    {
      name: 'linear_list_issues',
      description: 'List recent Linear issues (GraphQL).',
      kind: 'http_template',
      requiresApproval: true,
      template: {
        method: 'POST',
        url: 'https://api.linear.app/graphql',
        headers: {
          Authorization: `{{secret:${pluginId}}}`,
          'Content-Type': 'application/json',
        },
        body: '{"query":"{ issues(first: 15) { nodes { id identifier title state { name } url } } }"}',
      },
      params: {},
    },
  ]
}

export function figmaConnectorTools(pluginId = 'figma-connector'): CustomToolDefinition[] {
  return [
    httpGet(
      'figma_me',
      'Return the authenticated Figma user.',
      'https://api.figma.com/v1/me',
      pluginId,
    ),
    httpGet(
      'figma_get_file',
      'Get Figma file metadata by key.',
      'https://api.figma.com/v1/files/{{file_key}}',
      pluginId,
      { file_key: { type: 'string', description: 'Figma file key from URL', required: true } },
    ),
  ]
}

export function googleCalendarTools(pluginId = 'calendar-connector'): CustomToolDefinition[] {
  return [
    httpGet(
      'gcal_list_calendars',
      'List Google calendars for the authorized account.',
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      pluginId,
    ),
    httpGet(
      'gcal_list_events',
      'List events on a calendar. Pass calendarId (default primary) and optional timeMin ISO string.',
      'https://www.googleapis.com/calendar/v3/calendars/{{calendarId}}/events?maxResults=15&singleEvents=true&orderBy=startTime&timeMin={{timeMin}}',
      pluginId,
      {
        calendarId: { type: 'string', description: 'Calendar id — use primary if unsure', required: true },
        timeMin: { type: 'string', description: 'RFC3339 lower bound e.g. 2026-01-01T00:00:00Z', required: true },
      },
    ),
  ]
}

export function dropboxConnectorTools(pluginId = 'dropbox-connector'): CustomToolDefinition[] {
  return [
    {
      name: 'dropbox_list_folder',
      description: 'List files in a Dropbox folder path.',
      kind: 'http_template',
      requiresApproval: true,
      template: {
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/list_folder',
        headers: {
          Authorization: `Bearer {{secret:${pluginId}}}`,
          'Content-Type': 'application/json',
        },
        body: '{"path":"{{path}}","limit":50}',
      },
      params: {
        path: { type: 'string', description: 'Folder path ("" for root)', required: false },
      },
    },
  ]
}

export function clickupConnectorTools(pluginId = 'clickup-connector'): CustomToolDefinition[] {
  return [
    httpGet(
      'clickup_user',
      'Return the authenticated ClickUp user.',
      'https://api.clickup.com/api/v2/user',
      pluginId,
    ),
    httpGet(
      'clickup_list_teams',
      'List ClickUp workspaces (teams) for the token.',
      'https://api.clickup.com/api/v2/team',
      pluginId,
    ),
    httpGet(
      'clickup_list_tasks',
      'List tasks in a ClickUp list by list_id.',
      'https://api.clickup.com/api/v2/list/{{list_id}}/task?page=0',
      pluginId,
      { list_id: { type: 'string', description: 'ClickUp list id', required: true } },
    ),
  ]
}

export function asanaConnectorTools(pluginId = 'asana-connector'): CustomToolDefinition[] {
  return [
    httpGet(
      'asana_me',
      'Return the authenticated Asana user.',
      'https://app.asana.com/api/1.0/users/me',
      pluginId,
    ),
    httpGet(
      'asana_workspaces',
      'List Asana workspaces.',
      'https://app.asana.com/api/1.0/workspaces',
      pluginId,
    ),
    httpGet(
      'asana_tasks',
      'List incomplete tasks assigned to me in a workspace.',
      'https://app.asana.com/api/1.0/tasks?assignee=me&workspace={{workspace_gid}}&completed_since=now&limit=20',
      pluginId,
      { workspace_gid: { type: 'string', description: 'Asana workspace gid', required: true } },
    ),
  ]
}

export function canvaConnectorTools(pluginId = 'canva-connector'): CustomToolDefinition[] {
  return [
    httpGet(
      'canva_user',
      'Return the authenticated Canva user profile (Connect API).',
      'https://api.canva.com/rest/v1/users/me',
      pluginId,
    ),
  ]
}

export function sheetsConnectorTools(pluginId = 'spreadsheets-connector'): CustomToolDefinition[] {
  return [
    httpGet(
      'gsheets_get_values',
      'Read a range from a Google Spreadsheet.',
      'https://sheets.googleapis.com/v4/spreadsheets/{{spreadsheetId}}/values/{{range}}',
      pluginId,
      {
        spreadsheetId: { type: 'string', description: 'Spreadsheet id from URL', required: true },
        range: { type: 'string', description: 'A1 range e.g. Sheet1!A1:D20', required: true },
      },
    ),
  ]
}

/**
 * Home Assistant REST (local network).
 * Token = Long-Lived Access Token; base_url param defaults to http://homeassistant.local:8123
 */
export function homeAssistantConnectorTools(
  pluginId = 'homeassistant-connector',
): CustomToolDefinition[] {
  const authHeaders = {
    Authorization: `Bearer {{secret:${pluginId}}}`,
    'Content-Type': 'application/json',
  }
  const baseParams: CustomToolDefinition['params'] = {
    base_url: {
      type: 'string',
      description:
        'HA base URL, e.g. http://homeassistant.local:8123 or http://192.168.1.10:8123 (no trailing slash)',
      required: false,
    },
  }
  return [
    {
      name: 'ha_api_status',
      description: 'Ping Home Assistant /api/ to verify token and base URL.',
      kind: 'http_template',
      requiresApproval: true,
      template: {
        method: 'GET',
        url: '{{base_url}}/api/',
        headers: { ...authHeaders, Accept: 'application/json' },
      },
      params: baseParams,
    },
    {
      name: 'ha_list_states',
      description: 'List all entity states (can be large — prefer ha_get_state when entity_id known).',
      kind: 'http_template',
      requiresApproval: true,
      template: {
        method: 'GET',
        url: '{{base_url}}/api/states',
        headers: { ...authHeaders, Accept: 'application/json' },
      },
      params: baseParams,
    },
    {
      name: 'ha_get_state',
      description: 'Get one entity state, e.g. light.living_room or switch.fan.',
      kind: 'http_template',
      requiresApproval: true,
      template: {
        method: 'GET',
        url: '{{base_url}}/api/states/{{entity_id}}',
        headers: { ...authHeaders, Accept: 'application/json' },
      },
      params: {
        ...baseParams,
        entity_id: {
          type: 'string',
          description: 'Entity id like light.kitchen or climate.ac',
          required: true,
        },
      },
    },
    {
      name: 'ha_call_service',
      description:
        'Call a HA service (write). domain/service e.g. light/turn_on, switch/turn_off, script/turn_on. Always confirm with user for locks/alarms/garage.',
      kind: 'http_template',
      requiresApproval: true,
      template: {
        method: 'POST',
        url: '{{base_url}}/api/services/{{domain}}/{{service}}',
        headers: authHeaders,
        body: '{"entity_id":"{{entity_id}}"}',
      },
      params: {
        ...baseParams,
        domain: {
          type: 'string',
          description: 'Service domain: light | switch | climate | script | scene | …',
          required: true,
        },
        service: {
          type: 'string',
          description: 'Service name: turn_on | turn_off | toggle | …',
          required: true,
        },
        entity_id: {
          type: 'string',
          description: 'Target entity_id',
          required: true,
        },
      },
    },
  ]
}

export function connectorManifest(
  pluginId: string,
  name: string,
  tools: CustomToolDefinition[],
  promptAppend: string,
): Omit<PluginManifest, 'id' | 'name' | 'enabled'> {
  return {
    version: '1.0.0',
    description: `${name} connector tools (require stored secret).`,
    promptAppend,
    customTools: tools,
  }
}

/** Intent keywords → plugin id for preload */
export const CONNECTOR_INTENT_KEYWORDS: Record<string, string[]> = {
  'github-connector': ['github', 'pull request', 'pullrequest', ' pr ', 'issue', 'repo', 'ci'],
  'notion-connector': ['notion', 'wiki', '知識庫', '規格文件'],
  'linear-connector': ['linear', 'issue tracker', 'sprint'],
  'figma-connector': ['figma', '設計檔', 'design file'],
  'calendar-connector': ['calendar', '行程', '會議', 'gcal', 'google calendar'],
  'dropbox-connector': ['dropbox', '雲端檔'],
  'clickup-connector': ['clickup', '任務列表', 'task list'],
  'asana-connector': ['asana', '專案任務'],
  'canva-connector': ['canva', '品牌素材'],
  'spreadsheets-connector': ['spreadsheet', 'sheets', '試算表', 'google sheet'],
  'homeassistant-connector': [
    'home assistant',
    'homeassistant',
    'hass',
    '智能家居',
    '智慧家庭',
    '關燈',
    '開燈',
    '插座',
    '空調',
    'entity_id',
    'ha ',
  ],
  'web-reader': ['url', 'http', 'rss', '網頁', 'fetch', '抓取'],
  'git-workspace': ['git status', 'commit', 'branch', '工作樹'],
  'data-toolkit': ['json', 'table', '分析', 'analytics', 'csv'],
  'filesystem-mcp': ['filesystem', '專案目錄', '讀檔', 'workspace files'],
  'github-mcp': ['github mcp', 'mcp github', 'github api'],
  'notion-mcp': ['notion mcp', 'mcp notion'],
  'figma-mcp': ['figma mcp', 'mcp figma'],
  'brave-search-mcp': ['brave', 'brave search', '網路搜尋'],
  'brave-search': ['brave api', 'brave key'],
  'puppeteer-mcp': ['puppeteer', '瀏覽器自動化', 'screenshot'],
  'postgres-mcp': ['postgres', 'postgresql', 'sql', '資料庫'],
  'postgres-dsn': ['postgres dsn', 'connection string', '連線字串'],
  'memory-mcp': ['memory mcp', '知識圖譜', 'entity memory'],
  'sequential-thinking-mcp': ['sequential thinking', '推理鏈', 'step by step'],
}
