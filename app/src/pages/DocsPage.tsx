import { useState } from 'react'
import { Icon } from '../components/Icon'
import { ThemePage } from '../components/SectionNav'
import {
  SettingsGroup,
  SettingsHeader,
  SettingsRow,
  SettingsStack,
} from '../components/settings/SettingsChrome'

const SECTIONS = [
  { id: 'system', label: '系統定義', icon: 'account_tree' },
  { id: 'rules', label: '執行規則', icon: 'rule' },
  { id: 'schema', label: '解析 Schema', icon: 'data_object' },
  { id: 'capabilities', label: 'Capabilities', icon: 'extension' },
]

const META: Record<string, { title: string; subtitle: string }> = {
  system: {
    title: '系統定義',
    subtitle: 'Loop 核心週期與可預測編排概念。',
  },
  rules: {
    title: '執行規則',
    subtitle: '四種 Loop 模式的觸發、驗證與反模式。',
  },
  schema: {
    title: '解析 Schema',
    subtitle: '提示與輸出結構約定。',
  },
  capabilities: {
    title: 'Capability 原語',
    subtitle: 'Pydantic AI 2.0 風格：工具 + runbook 打包、漸進式披露。',
  },
}

const LOOP_STEPS = [
  { icon: 'input', label: '接收輸入' },
  { icon: 'memory', label: '處理推理' },
  { icon: 'play_arrow', label: '執行動作' },
  { icon: 'check_circle', label: '驗證結果' },
  { icon: 'stop_circle', label: '終止／迭代' },
]

const PATTERNS = [
  {
    title: '模式 1：回合制',
    icon: 'sync',
    model: '1 輸入 = 1 動作',
    trigger: '使用者請求（同步）',
    validation: '輸出 schema 相符／使用者 ACK',
    anti: '未獲使用者確認就無限循環',
  },
  {
    title: '模式 2：目標導向',
    icon: 'target',
    model: '自主迭代',
    trigger: '指派複雜目標',
    validation: '子任務完成指標／DoD',
    anti: '偏離主要目標（幻覺）',
  },
  {
    title: '模式 3：定時觸發',
    icon: 'schedule',
    model: 'Cron 式執行',
    trigger: '系統時鐘到達時間戳',
    validation: '成功擷取並投遞資料',
    anti: '資料源不可達仍執行；高頻 < 10 分鐘',
  },
  {
    title: '模式 4：主動觸發',
    icon: 'bolt',
    model: '事件驅動執行',
    trigger: 'Webhook／關鍵字／狀態變更',
    validation: '動作完全符合事件參數',
    anti: '模糊邏輯或語意近似觸發',
  },
]

export function DocsPage() {
  const [section, setSection] = useState('system')
  const meta = META[section] || META.system

  return (
    <ThemePage title="文件說明" sections={SECTIONS} activeId={section} onChange={setSection}>
      <SettingsHeader title={meta.title} subtitle={meta.subtitle} />

      {section === 'system' && (
        <>
          <SettingsGroup title="執行週期">
            <div className="px-4 py-5 flex flex-wrap items-center justify-between gap-3">
              {LOOP_STEPS.map((s, i) => (
                <div key={s.label} className="contents">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-11 h-11 rounded-full border border-primary/40 flex items-center justify-center bg-primary/10">
                      <Icon name={s.icon} className="text-primary" size={20} />
                    </div>
                    <span className="text-[11px] text-on-surface-variant text-center">{s.label}</span>
                  </div>
                  {i < LOOP_STEPS.length - 1 && (
                    <Icon
                      name="arrow_forward"
                      className="text-outline hidden sm:block"
                      size={16}
                    />
                  )}
                </div>
              ))}
            </div>
          </SettingsGroup>
          <SettingsGroup title="核心概念">
            <SettingsStack title="Loop">
              <p className="text-[13px] text-on-surface-variant leading-relaxed">
                「Loop」是自動執行週期：接收輸入 → 處理／推理 → 執行動作 → 驗證結果 → 終止或迭代。
                所有代理行為應可審計、可中止，並遵守安全閘道。
              </p>
            </SettingsStack>
            <SettingsStack title="Definition of Done">
              <p className="text-[13px] text-on-surface-variant leading-relaxed">
                每個目標需有可量測的完成條件；未滿足時應迭代或請求人工介入，而非假裝成功。
              </p>
            </SettingsStack>
          </SettingsGroup>
        </>
      )}

      {section === 'rules' && (
        <div className="space-y-1">
          {PATTERNS.map((p) => (
            <SettingsGroup key={p.title} title={p.title}>
              <SettingsRow title="模型" control={<span className="text-[12px] text-outline">{p.model}</span>} />
              <SettingsRow
                title="觸發"
                control={<span className="text-[12px] text-on-surface-variant text-right max-w-[240px]">{p.trigger}</span>}
              />
              <SettingsRow
                title="驗證"
                control={
                  <span className="text-[12px] text-on-surface-variant text-right max-w-[240px]">
                    {p.validation}
                  </span>
                }
              />
              <SettingsRow
                title="反模式"
                description={p.anti}
                control={<Icon name={p.icon} size={18} className="text-primary" />}
              />
            </SettingsGroup>
          ))}
        </div>
      )}

      {section === 'schema' && (
        <SettingsGroup title="提示約定">
          <SettingsStack title="系統層">
            <p className="text-[13px] text-on-surface-variant leading-relaxed">
              穩定層：身份與技能索引。上下文層：AGENTS.md／專案。動態層：記憶與當前目標。
            </p>
          </SettingsStack>
          <SettingsStack title="工具結果">
            <p className="text-[13px] text-on-surface-variant leading-relaxed">
              工具輸出優先於模型臆測；失敗時回報錯誤字串，不得捏造成功。
            </p>
          </SettingsStack>
          <SettingsStack title="輸出">
            <p className="text-[13px] text-on-surface-variant leading-relaxed">
              使用者可見內容使用繁體中文；程式碼與 JSON 鍵名可維持英文。
            </p>
          </SettingsStack>
        </SettingsGroup>
      )}

      {section === 'capabilities' && (
        <>
          <SettingsGroup title="為什麼需要 Capability">
            <SettingsStack title="一個原語">
              <p className="text-[13px] text-on-surface-variant leading-relaxed">
                參考 Pydantic AI 2.0：把「工具 + 說明（runbook）+ 邊界」打成可組合單元，而不是把參數散落在
                Agent 建構子各處。一個 capability 是可重用的代理行為片段。
              </p>
            </SettingsStack>
            <SettingsStack title="漸進式披露">
              <p className="text-[13px] text-on-surface-variant leading-relaxed">
                預設只把 deferred capability 收成一行目錄（id + description）。模型需要時呼叫
                <code className="text-primary mx-1">load_capability</code>
                ，一次載入整包工具與 runbook。已載入的在本輪後續請求維持開啟。
              </p>
            </SettingsStack>
            <SettingsStack title="更省、更可控">
              <p className="text-[13px] text-on-surface-variant leading-relaxed">
                不在每一輪塞入全部 MCP／工具 schema，降低 token 與選錯工具的機率；敏感能力可拆成獨立
                capability 並搭配權限／HITL。
              </p>
            </SettingsStack>
          </SettingsGroup>
          <SettingsGroup title="內建能力包">
            {[
              ['core-utils', '時間／結構化抽取（預設 always-on）'],
              ['web-research', 'web_search + http_fetch'],
              ['workspace', '沙箱檔案讀寫'],
              ['shell', 'bash'],
              ['memory / skills / codegraph', '記憶、技能、程式索引'],
              ['delegate / messaging / mcp:*', '委派、閘道、各 MCP 伺服器'],
            ].map(([id, desc]) => (
              <SettingsRow
                key={id}
                title={id}
                description={desc}
                control={<Icon name="extension" size={16} className="text-primary" />}
              />
            ))}
          </SettingsGroup>
          <SettingsGroup title="設定與執行面">
            <SettingsStack title="開關">
              <p className="text-[13px] text-on-surface-variant leading-relaxed">
                設定 → 安全與工具 →「Capability 漸進披露」。可點選 always-on 包強制第一輪就載入。關閉後回到一次暴露全部工具。
              </p>
            </SettingsStack>
            <SettingsStack title="執行面板">
              <p className="text-[13px] text-on-surface-variant leading-relaxed">
                Run 面板與成功頁會顯示本輪已載入的 capability ids（always-on + load_capability）。
              </p>
            </SettingsStack>
          </SettingsGroup>
        </>
      )}
    </ThemePage>
  )
}
