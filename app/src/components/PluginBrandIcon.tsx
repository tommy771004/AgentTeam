/**
 * Marketplace brand tiles — official Simple Icons paths (CC0-1.0).
 * @see https://simpleicons.org
 */

import { useMemo } from 'react'
import {
  siAdobe,
  siAsana,
  siCanva,
  siClickup,
  siDropbox,
  siFigma,
  siFiles,
  siGit,
  siGithub,
  siGoogleanalytics,
  siGooglecalendar,
  siGooglechrome,
  siGooglesheets,
  siGoogleslides,
  siLinear,
  siNotion,
  type SimpleIcon,
} from 'simple-icons'
import { catalogItem } from '../agent/hermes/pluginCatalog'

const BY_SLUG: Record<string, SimpleIcon> = {
  Adobe: siAdobe,
  Asana: siAsana,
  Canva: siCanva,
  Clickup: siClickup,
  Dropbox: siDropbox,
  Figma: siFigma,
  Files: siFiles,
  Git: siGit,
  Github: siGithub,
  Googleanalytics: siGoogleanalytics,
  Googlecalendar: siGooglecalendar,
  Googlechrome: siGooglechrome,
  Googlesheets: siGooglesheets,
  Googleslides: siGoogleslides,
  Linear: siLinear,
  Notion: siNotion,
}

/** Resolve a legible mark color without adding a colored tile behind it. */
function markStyle(hex: string): { bg: string; border?: string; fg: string } {
  const raw = hex.replace('#', '')
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum < 0.22) {
    return { bg: 'transparent', fg: 'var(--color-ink-2)' }
  }
  if (lum > 0.85) {
    return { bg: 'transparent', fg: 'var(--color-ink)' }
  }
  return { bg: 'transparent', fg: `#${raw}` }
}

function resolveIcon(pluginId: string, brandIcon?: string): SimpleIcon | null {
  if (brandIcon && BY_SLUG[brandIcon]) return BY_SLUG[brandIcon]
  const item = catalogItem(pluginId)
  if (item?.brandIcon && BY_SLUG[item.brandIcon]) return BY_SLUG[item.brandIcon]
  return null
}

export function PluginBrandIcon({
  pluginId,
  name,
  accent,
  size = 18,
  className = '',
  brandIcon,
}: {
  pluginId: string
  name?: string
  accent: string
  size?: number
  className?: string
  brandIcon?: string
}) {
  const icon = useMemo(() => resolveIcon(pluginId, brandIcon), [pluginId, brandIcon])
  const letter = (name || pluginId).trim()[0]?.toUpperCase() || '?'
  const hex = icon?.hex || accent.replace('#', '')
  const style = markStyle(hex.length === 6 ? hex : '64748b')

  if (!icon) {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 font-bold ${className}`}
        style={{ width: size, height: size, color: style.fg, fontSize: size * 0.55 }}
        aria-hidden
      >
        {letter}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, color: style.fg }}
      aria-hidden
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className="block"
        role="img"
      >
        <title>{icon.title}</title>
        <path d={icon.path} />
      </svg>
    </span>
  )
}

/** Sized hit area for a marketplace mark; the surface stays transparent. */
export function PluginBrandTile({
  pluginId,
  name,
  accent,
  brandIcon,
  size = 36,
  iconSize,
  className = '',
  title,
  onClick,
}: {
  pluginId: string
  name?: string
  accent: string
  brandIcon?: string
  size?: number
  iconSize?: number
  className?: string
  title?: string
  onClick?: () => void
}) {
  const icon = resolveIcon(pluginId, brandIcon)
  const hex = icon?.hex || accent.replace('#', '')
  const style = markStyle(hex.length === 6 ? hex : accent.replace('#', ''))
  const glyph = iconSize ?? Math.round(size * 0.55)
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      title={title}
      onClick={onClick}
      className={`flex items-center justify-center shrink-0 ${
        onClick ? 'transition-colors hover:text-on-surface' : ''
      } ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: 'transparent',
        border: '0',
        color: style.fg,
      }}
    >
      <PluginBrandIcon
        pluginId={pluginId}
        name={name}
        accent={accent}
        brandIcon={brandIcon}
        size={glyph}
      />
    </Tag>
  )
}
