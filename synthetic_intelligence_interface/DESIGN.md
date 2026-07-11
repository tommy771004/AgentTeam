---
name: Synthetic Intelligence Interface
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bbc9cd'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#859397'
  outline-variant: '#3c494c'
  surface-tint: '#2fd9f4'
  primary: '#8aebff'
  on-primary: '#00363e'
  primary-container: '#22d3ee'
  on-primary-container: '#005763'
  inverse-primary: '#006877'
  secondary: '#d0bcff'
  on-secondary: '#3c0091'
  secondary-container: '#571bc1'
  on-secondary-container: '#c4abff'
  tertiary: '#ffd0e3'
  on-tertiary: '#620040'
  tertiary-container: '#ffa6cf'
  on-tertiary-container: '#8f1e62'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#a2eeff'
  primary-fixed-dim: '#2fd9f4'
  on-primary-fixed: '#001f25'
  on-primary-fixed-variant: '#004e5a'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#ffd8e7'
  tertiary-fixed-dim: '#ffafd3'
  on-tertiary-fixed: '#3d0026'
  on-tertiary-fixed-variant: '#85145a'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Sora
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
  code-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  xxl: 80px
  container-max: 1440px
  gutter: 24px
---

## Brand & Style
The design system is engineered to evoke a sense of advanced computational power, collaborative intelligence, and seamless efficiency. It targets developers, data scientists, and enterprise teams who require a high-performance environment for orchestrating AI agents.

The aesthetic blends **Modern Corporate** structure with **Glassmorphism** and **Futuristic** accents. The UI feels like a high-end command center—dark, focused, and immersive. Key visual drivers include:
- **Depth through Transparency:** Utilizing blurred surfaces to maintain context while focusing on active tasks.
- **Luminosity:** Subtle glows and neon-tinted borders that simulate active data processing.
- **Precision:** A strict adherence to grid systems and lean, technical typography to signify reliability.

## Colors
The palette is rooted in a "Deep Space" dark mode. 
- **Core Surfaces:** The deepest layer uses Charcoal (#0F172A), while elevated surfaces move into Indigo-Slate (#1E293B).
- **Primary Action (Cyan):** Used for primary CTAs, active states, and successful status indicators. It represents "Signal" and "Output."
- **Secondary Action (Violet):** Used for AI-driven features, processing states, and collaborative indicators. It represents "Intelligence" and "Synthesis."
- **Functional Gradients:** Linear gradients moving from Cyan to Violet are used sparingly for high-impact moments like "Agent Initialization" or "System Health."

## Typography
The system uses a dual-font approach to balance personality with utility.
- **Sora (Headlines):** Its geometric construction and unique "ink traps" provide a technical, futuristic edge. Use it for page titles and section headers to establish a distinct brand voice.
- **Inter (Body & UI):** Chosen for its exceptional legibility in data-dense environments. Its neutral tone ensures that complex AI outputs and code snippets remain readable at small sizes.
- **Letter Spacing:** Headlines should feature slight negative tracking for a tighter, more "engineered" look. Labels and small metadata should use increased tracking for clarity.

## Layout & Spacing
The layout follows a **Strict Fluid Grid** model based on a 4px baseline.
- **Desktop:** 12-column grid with a 24px gutter. Content is centered with a 1440px max-width to prevent line lengths from becoming unreadable.
- **Tablet:** 8-column grid with 16px gutters and 24px side margins.
- **Mobile:** 4-column grid with 16px side margins.
- **Information Density:** For agent configuration screens, use a "High-Density" layout with 8px spacing units. For dashboards and landing pages, use "Low-Density" with 48px+ vertical padding to emphasize the "Glass" surfaces.

## Elevation & Depth
Depth is created through "Luminous Layering" rather than traditional shadows.
- **Level 0 (Base):** Deep Indigo (#0F172A). The "void" layer.
- **Level 1 (Cards/Containers):** Charcoal (#1E293B) with a 1px border at 10% opacity white. 
- **Level 2 (Active/Floating):** Background blur (backdrop-filter: blur(12px)) with a semi-transparent fill of #1E293B (70% opacity).
- **Glow Effects:** Active elements use a 1px "inner glow" or a very soft, outer drop shadow using the primary Cyan color at 20% opacity.
- **Glassmorphism:** Navigation rails and modal overlays must use the backdrop blur effect to maintain a sense of environmental depth.

## Shapes
The system utilizes **Soft (0.25rem)** roundedness to maintain a professional, architectural feel. 
- **Standard UI (Buttons, Inputs, Small Cards):** 4px (0.25rem) radius. This sharp cornering communicates precision and technical rigor.
- **Large Containers (Modals, Feature Cards):** 8px (0.5rem) radius to soften the high-contrast edges of the dark UI.
- **Avatars/Indicators:** Circular (pill-shaped) to distinguish human or agent entities from structural data containers.

## Components
- **Buttons:** Primary buttons use a solid Cyan fill with dark text. Secondary buttons use a "Ghost" style: 1px Cyan border with a subtle glow on hover.
- **Inputs:** Dark backgrounds (#0F172A) with a 1px border. When focused, the border transitions to a Violet gradient and the background gains a slight inner glow.
- **Chips/Status:** Small, high-contrast badges. "Running" status uses a pulsing Cyan dot; "Paused" uses Violet.
- **Cards:** Glassmorphic containers. A 1px top-left highlight (white at 5% opacity) should be used to simulate a light source reflecting on the "glass" edge.
- **Agent Nodes:** Circular icons with a Violet-to-Cyan gradient ring, representing the AI's "consciousness" or active state.
- **Lists:** Clean rows with 1px slate dividers (10% opacity). Hovering a row should trigger a subtle shift in background brightness.