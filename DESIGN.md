# DESIGN.md

## 1. Product Intent

Multi-AI Session Hub is not a marketing site. It is a desktop-style workbench for people who read, retrieve, review, and refine AI work history for real tasks.

The UI should feel like:
- a calm dark workspace
- information-dense but not crowded
- engineered and trustworthy, not flashy
- optimized for long sessions, evidence review, and repeated daily use

Core product promise:
- Find past AI work quickly
- Understand why a result was matched
- Turn scattered conversations into durable knowledge

The interface should always prioritize:
1. current context
2. primary action
3. evidence and status
4. secondary tooling

## 2. Visual Theme & Atmosphere

Direction: restrained dark-mode-native workbench.

Primary references:
- Linear for hierarchy restraint and surface control
- Raycast for dark desktop utility feel
- Notion for content readability and low-noise structure

Avoid:
- overly glossy glassmorphism
- decorative gradients on every surface
- loud neon accents
- multiple visual languages across different modules

The product should feel more like a serious review console than a demo dashboard.

## 3. Color Palette & Roles

### Core Surfaces
- App Background: `#0a0d12`
- Sidebar Background: `#0f131a`
- Panel Background: `#121821`
- Elevated Surface: `#171f2a`
- Hover Surface: `#1b2430`
- Soft Surface: `#10161e`

### Text
- Primary Text: `#f3f6fb`
- Secondary Text: `#c3ccd8`
- Muted Text: `#8693a3`
- Disabled Text: `#5f6a78`

### Accent
- Primary Accent: `#6f86ff`
- Accent Hover: `#8fa0ff`
- Accent Soft Bg: `rgba(111, 134, 255, 0.14)`
- Accent Ring: `rgba(111, 134, 255, 0.35)`

### Semantic
- Success: `#23a36d`
- Success Soft: `rgba(35, 163, 109, 0.14)`
- Warning: `#d69a2d`
- Warning Soft: `rgba(214, 154, 45, 0.14)`
- Danger: `#d84d6a`
- Danger Soft: `rgba(216, 77, 106, 0.14)`
- Info: `#4aa3ff`
- Info Soft: `rgba(74, 163, 255, 0.14)`

### Borders
- Subtle Border: `rgba(255, 255, 255, 0.06)`
- Standard Border: `rgba(255, 255, 255, 0.09)`
- Strong Border: `rgba(255, 255, 255, 0.14)`

### Rules
- Use the accent color mostly for active state, focus state, selected state, and primary CTA.
- Use semantic colors only for meaning, never for decoration.
- Provider colors may exist in badges, but they must not overpower page hierarchy.

## 4. Typography Rules

### Font Families
- Primary UI Sans: `Inter`, `PingFang SC`, `Noto Sans SC`, `system-ui`, sans-serif
- Monospace: `JetBrains Mono`, `SFMono-Regular`, `Menlo`, monospace

### Hierarchy
- Page Title: 24px / weight 600 / line-height 1.2
- Section Title: 18px / weight 600 / line-height 1.3
- Card Title: 15px / weight 600 / line-height 1.35
- Body: 14px / weight 400 / line-height 1.55
- UI Label: 13px / weight 500 / line-height 1.4
- Meta / Caption: 12px / weight 500 / line-height 1.4
- Micro Meta: 11px / weight 500 / line-height 1.35

### Principles
- Use one sans family across the whole application.
- Do not mix expressive display fonts with system-like dense UI.
- Titles should be short and calm, not oversized.
- Dense data should rely on spacing and weight, not tiny font sizes.
- Code, file paths, conversation ids, and evidence snippets should use monospace selectively.

## 5. Layout Principles

### App Shell
- Left sidebar is for navigation only.
- Top toolbar is for context and high-priority actions only.
- Main area should present one dominant workflow at a time.

### Density
- The app is medium-density by default.
- Avoid trying to expose every control at once.
- Advanced filters and secondary controls should be collapsible or grouped.

### Spacing Scale
- 4px, 8px, 12px, 16px, 20px, 24px, 32px
- Prefer 12px and 16px as the default internal rhythm
- Prefer 20px and 24px between major content blocks

### Radius Scale
- 6px: compact controls
- 8px: buttons, inputs, chips
- 12px: cards, list items
- 16px: large panels only

### Elevation
- Most surfaces should be separated by border and tone, not heavy shadow
- Use only subtle shadows for overlays and selected cards
- Avoid blur-heavy backgrounds in normal work surfaces

## 6. Navigation & Information Architecture

Sidebar groups should be explicit:
- Sessions
- Knowledge Workbench
- Review Tools
- System Settings

Rules:
- Do not mix data-source navigation with tool navigation without labels
- The current active area must be obvious at first glance
- Collapsed sidebar should still preserve recognizability through strong icon/badge consistency

Toolbar rules:
- Left side: where am I, what am I looking at
- Right side: only the 2 to 4 most relevant actions for this area
- If actions exceed 4, move extras into an overflow or local panel header

## 7. Component Stylings

### Buttons

Primary Button
- Background: Primary Accent
- Text: white
- Radius: 8px
- Height: 36px to 40px
- Use only for the main task on the current screen

Secondary Button
- Background: Elevated Surface
- Text: Primary Text
- Border: Standard Border
- Use for visible but non-primary actions

Ghost Button
- Background: transparent or Soft Surface
- Text: Secondary Text
- Border: optional subtle border
- Use for contextual utilities, row actions, toolbar utilities

Danger Button
- Background: Danger Soft or solid danger depending on severity
- Text should remain highly legible
- Use sparingly and near destructive confirmation context

### Inputs
- Height: 36px to 40px
- Background: Soft Surface
- Border: Standard Border
- Placeholder: Muted Text
- Focus: Accent Ring plus border emphasis

### Cards
- Background: Panel Background or Elevated Surface
- Border: Subtle or Standard Border
- Radius: 12px
- Hover: slight border lift and tone shift, not dramatic movement

### Chips / Tags
- Use compact pill treatment
- Default chips should be neutral
- Semantic chips should be soft-tinted, not saturated blocks
- Provider chips should be readable and compact, but not become the loudest element in a row

### Empty States
- Should reassure and guide
- Include one sentence on why the area is empty
- Include one clear next action
- Avoid oversized glows and hero-style theatrics in work panels

### Tables and Lists
- Prioritize scanability
- Selected row/card should be obvious through border + background + optional accent edge
- Metadata must be grouped and de-emphasized
- Row actions should not compete with the row title

## 8. Workflow-Specific Guidance

### Session Workspace
- This is the product core and should define the base language for the whole app
- Search and filtering should feel fast and compact
- Evidence status should appear after the search input, but secondary details should stay collapsed by default
- Session list should emphasize title, provider, review state, last updated time
- Detail view should emphasize conversation readability, not decoration

### Knowledge Workbench
- Keep the same base shell as Session Workspace
- Hero blocks should be used sparingly and only for orientation
- Avoid making this area look like a separate product
- Review queues, health checks, and source editing should feel like variations of one system

### Bug Trace / Review Panels
- Treat these as utility workflows inside the same product
- Code and diff surfaces may use monospace-heavy styling, but surrounding chrome should remain consistent with the main app
- Do not switch to a completely different card and spacing language

### Settings / Management
- Prefer structured lists and forms over decorative showcase layouts
- These screens should feel operational and clear

## 9. Interaction & Motion

### Motion
- Use fast, subtle transitions: 120ms to 180ms for hover/focus, 180ms to 240ms for panel swaps
- Avoid floating animations, large parallax, and dramatic transforms
- Hover lift should be at most 1px to 2px

### Focus & Accessibility
- Every interactive element must have a visible `:focus-visible` state
- Icon-only buttons must have accessible labels
- Small segmented controls and tabs must still meet practical click/tap area expectations

### State Feedback
- Loading should feel calm and structural
- Success and error should appear near the affected action or content
- System status chips must be understandable without reading long helper text

## 10. Do's and Don'ts

### Do
- Keep one coherent dark workbench language across all modules
- Let content hierarchy carry the screen, not visual effects
- Use accent color intentionally and sparingly
- Make current context, next action, and status immediately scannable
- Favor readable body text and controlled density over “futuristic” styling

### Don't
- Don’t stack blur, glow, gradients, and colored chips on the same surface
- Don’t let toolbars become icon graveyards
- Don’t invent a new visual style for each feature area
- Don’t rely on color alone to express importance
- Don’t make empty states more dramatic than real content

## 11. Responsive Behavior

The app is desktop-first, but should remain usable on narrower windows.

Rules:
- Toolbar actions should wrap or collapse cleanly
- Filter bars should stack before content becomes cramped
- Sidebar collapse must preserve active-state clarity
- Two-column work areas should collapse only when readability truly improves

## 12. Agent Prompt Guide

When generating or refactoring UI for this project, use prompts like:

- "Design this screen as a restrained dark productivity workbench with clear hierarchy, subtle borders, minimal glow, and medium information density."
- "Keep the shell consistent with the session workspace: calm dark surfaces, compact controls, readable list/detail layout, and sparing accent use."
- "Prioritize current context, primary action, and evidence status. Reduce secondary controls and avoid decorative gradients unless used once for orientation."
- "Make this feel like a serious review console for AI work history, not a marketing dashboard."
