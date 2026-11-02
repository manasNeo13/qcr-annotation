# NeoQCR Frontend Style Guide

Source of truth for visual style in `frontend/`. Values below come straight from code.

| Concern | File |
|---|---|
| Dashboard theme (MUI) | `src/themes/index.js`, `src/themes/Chip.js` |
| Color tokens (SCSS → JS) | `src/assets/scss/_themes-vars.scss` (All), `_themes2-vars.scss` (Blush), `_themes3-vars.scss` (Lace) |
| Tailwind config | `tailwind.config.js` |
| Global CSS | `src/index.css` |
| Public pages tokens (landing, auth) | `src/views/Landing/neoqcr.css` |
| Landing page | `src/views/Landing/landing.css` |
| Login / onboarding | `src/views/Login/auth.css` |

---

## 1. Stack

- **MUI v5** (`@mui/material`, Emotion) — main component library for dashboard. Style via `sx={{}}` and theme overrides.
- **Tailwind CSS** — utility classes for layout/spacing, mixed with MUI. No preflight changes.
- **Plain CSS with `nq-` prefix** — public pages (landing, login, onboarding), scoped under `.nq`.
- **Charts** — ApexCharts, Highcharts, Recharts.
- **Icons** — `@mui/icons-material` (primary), `react-icons`, `lucide-react` (public pages), FontAwesome.
- **Motion** — `framer-motion` in React; CSS keyframes (`nq*`) on public pages.
- **Toasts** — `react-hot-toast`.

---

## 2. Color

### 2.1 Brand themes

User-switchable via Redux `customization.flType` (`'All' | 'Blush' | other → Lace`). Default `All`.

| Token | All (default) | Blush | Lace |
|---|---|---|---|
| `primary` | `#00ac69` | `#e770b0` | `#dca080` |
| `primaryLight` | `#4ade80` | `#f4bedb` | `#f0c2aa` |
| `primaryDark` | `#16a34a` | `#e04498` | `#eb7e43` |
| `primary100` | `#86efac` | `#86efac` | `#dca080` |

Tailwind mirrors these as `customAll`, `customBlush`, `customLace` (`light` / `DEFAULT` / `dark`):

```
customAll:   #33bc87 / #00ac69 / #007849
customBlush: #f4bedb / #e770b0 / #e04498
customLace:  #d6b4a2 / #dca080 / #e7834e
```

### 2.2 Shared semantic colors (all themes)

| Role | Light | Main | Dark |
|---|---|---|---|
| Secondary (slate) | `#60696d` | `#425466` | `#272f33` |
| Error | `#ec4333` | `#ff413a` | `#a20e00` |
| Warning | `#f6b333` | `#f4a100` | `#aa7000` |
| Info (cyan) | `#33d8dd` | `#00cfd5` | `#009095` |
| Success | `#33bc87` | `#00ac69` | `#007849` |

### 2.3 Neutrals, text, surfaces

| Token | Value | Use |
|---|---|---|
| `backgound` (sic) | `#f0f2f8` | App background, table head |
| `paper` | `#ffffff` | Cards, panels |
| `paperDark` | `#232b38` | `palette.common.black` |
| `bg100` | `#f8f8f9` | Subtle fills |
| `grey300` | `#425466` | |
| `menuHover` | `#e3f2fd` | |
| `textPrimary` | `#242c3a` | Body text, menu items |
| `textSecondary` | `#1b212c` | h4–h6, subtitles |
| `textDark` | `#12171e` | h1–h3, table headers, inputs |
| `textHint` | `#00000061` | Captions, default avatar bg |

Scrollbar thumb: `#cbd5e1`.

### 2.4 Public pages palette (`.nq` scope)

```css
--bg: #f0f2f8;        --surface: #ffffff;     --surface-2: #f8fafc;
--border: #e2e8f0;    --border-s: #cbd5e1;
--brand: #00ac69;     --brand-hover: #16a34a; --brand-dark: #007849;
--brand-soft: #ecfdf5; --brand-100: #a7f3d0;
--accent: #00cfd5;    --accent-dark: #009095;
--green: #16a34a;     --amber: #f4a100;       --red: #ff413a;
--text: #242c3a;      --muted: #425466;       --subtle: #94a3b8;
```

Gradients:

```css
--brand-grad:   linear-gradient(120deg, #00ac69 0%, #00ac69 45%, #00cfd5 130%);
--brand-grad-h: linear-gradient(120deg, #007849 0%, #00ac69 45%, #00cfd5 120%); /* hover */
--text-grad:    linear-gradient(110deg, #007849, #00ac69 50%, #009095);
.grad (Tailwind utility): linear-gradient(-225deg, #3584a7 0%, #473b7b 100%);
```

**Rule:** green `#00ac69` = brand + success. Cyan `#00cfd5` = accent only. Never introduce new hues without adding a token.

---

## 3. Typography

- **Font:** `'Baloo 2', sans-serif` everywhere (Google Fonts, weights 400–800, loaded in `index.css`).
- Public pages: `'Baloo 2', system-ui, sans-serif`, `line-height: 1.6`, antialiased.

### MUI scale

| Variant | Size | Weight | Color |
|---|---|---|---|
| h1 | 2.2rem | 600 | textDark |
| h2 | 2rem | 600 | textDark |
| h3 | 1.5rem | 600 | textDark |
| h4 | 1.25rem | 500 | textSecondary |
| h5 | 1.125rem | 600 | textSecondary |
| h6 | 0.875rem | 600 | textSecondary |
| subtitle1 | 0.875rem | 500 | textSecondary, lh 1.643em |
| subtitle2 | 0.8125rem | 400 | — |
| body1 | 0.875rem | 400 | lh 1.643em |
| body2 | inherit | 400 | lh 1.643em |
| caption | 0.68rem | 500 | textHint |

Custom variants: `menuCaption` (0.6875rem, 600, primary, uppercase), `subMenuCaption` (0.6875rem, 400, capitalize), `cardTitle` (1rem, primary), `breadcrumbTitle` (1.5rem, 500, textDark).

### Public pages type

- Wordmark: `800 22px/1`, `letter-spacing: -0.4px`; "Neo" = `--text`, "QCR" = `--brand-grad` clipped text. 34px on auth visual.
- Eyebrow: 12px, 700, `letter-spacing: 1.8px`, uppercase, `--brand-dark`.
- Badge: 10px, 700, `letter-spacing: 1.2px`, uppercase.
- Label: 13.5px / 600 / `--muted`. Input text 15px. Error text 12.5px.
- Button: 15px / 600.

---

## 4. Shape & elevation

### Radius

| Context | Radius |
|---|---|
| MUI Paper (rounded) | 10px |
| MUI Chip | 4px |
| Public buttons, inputs | 8px |
| Public badges | 5px |
| Landing cards | 10–20px (20px most common) |
| Tailwind | `rounded-full` (pills/avatars), `rounded-md`, `rounded-lg`, `rounded-xl` |

### Shadows

```css
/* MUI Paper elevation1 */
0 4px 6px -2px rgb(0 0 0 / 12%), 0 2px 2px -1px rgb(0 0 0 / 5%)

/* Public pages */
--shadow-sm: 0 1px 2px rgba(15,23,42,.05), 0 1px 3px rgba(15,23,42,.07);
--shadow:    0 12px 32px rgba(15,23,42,.08);
--shadow-lg: 0 32px 72px rgba(15,23,42,.14);

/* Brand glow (primary button) */
0 6px 18px rgba(0,172,105,.22)   → hover 0 12px 30px rgba(0,172,105,.30)
```

Accordion, TableContainer: `box-shadow: none`.

---

## 5. Spacing

- MUI Card header / content / actions: `24px` padding.
- Table cells: `16px 36px`; checkbox cell `padding-left: 18px`.
- List items: `12px` vertical padding; list icon `min-width: 36px`.
- Form field gap: `16px` bottom; two-column `.nq-row` gap `14px`.
- Button: `min-height: 48px`, `padding: 10px 22px`, icon gap `8px`.
- Input: `min-height: 46px`, `padding: 10px 14px`.
- Tailwind spacing scale for everything else.

---

## 6. Components

### Buttons (public)

| Class | Look |
|---|---|
| `.nq-btn-primary` | `--brand-grad` bg, white text, green glow; hover → darker gradient + `translateY(-2px)` |
| `.nq-btn-ghost` | white bg, `--border-s` border, `--muted` text; hover → brand border/text, `--brand-soft` bg |
| `.nq-btn-shine` | animated white shimmer sweep (2.8s loop) |
| `.nq-btn-block` | full width |
| `:disabled` | `opacity: .6`, no pointer events |

Ripple: `.nq-ripple` span, white 35%, 0.65s.

### Inputs (public)

- Rest: `--surface-2` bg, `--border-s` border.
- Hover: border `#94a3b8`.
- Focus: border `--brand`, white bg, ring `0 0 0 4px rgba(0,172,105,.14)`.
- Error `.err`: border `--red`, bg `#fff5f5`, ring `rgba(255,65,58,.1)`; message `.nq-ferr`.
- Select: custom chevron SVG, `padding-right: 38px`.
- Password: `.nq-pw` wrapper + 36px `.nq-pw-toggle`.

### MUI overrides

- **Chip:** white text (`grey[100]`), radius 4, `light` variant with error/success/warning sub-variants.
- **List item (sidebar):** selected/hover → primary color.
- **Table head:** `#f0f2f8` bg, 600 weight, textDark.
- **SvgIcon:** default 1.3rem, large 2.1875rem.
- **Input text:** textDark.

### Status indicators

- `.nq-signal` — 7px dot, brand, 4px soft halo, pulse 2s.
- `.nq-success-ico` — 64px circle, `--brand-soft` bg, 8px halo.

---

## 7. Motion

- Easing (entrances): `cubic-bezier(0.22, 0.68, 0, 1.2)` — slight overshoot.
- Standard transitions: `0.2s` on color, border, background, shadow, transform.
- Entrances: `nqFadeUp` (16px rise, 0.5–0.7s), `nqFromLeft`, `nqFromRight`, `nqPop`.
- Loops: `nqPulse`, `nqShimmer`, `nqSpin` (0.8s), scan/ring effects (`nqScanLine`, `nqRingCW/CCW`, `nqFloatA/B`) on landing visuals.
- **Respect `prefers-reduced-motion`** — `.nq` collapses all animations/transitions to 0.01ms. Do the same for new animated UI.

---

## 8. Layout & breakpoints

- Auth split screen: visual panel `flex: 0 0 55%` (46% compact), sticky full-height.
- Public breakpoints in use: `1180`, `1060`, `960`, `680`, `600`, `560`, `480` px (max-width).
- `.nq-row` stacks to one column ≤ 560px.
- Dashboard uses MUI breakpoints (`xs/sm/md/lg/xl`) + Tailwind (`sm/md/lg/xl`).

---

## 9. Accessibility

- Focus ring: `outline: 2px solid var(--brand); outline-offset: 3px` on `:focus-visible`.
- Selection: `--brand-100` bg, `--text` color.
- Hidden number spinners globally; keep labels on all inputs.

---

## 10. Utilities (`index.css`)

- `.scrollbar` / `.scrollbarSmall` — rounded slim scrollbar, thumb `#cbd5e1`.
- `.scrollbar-hide` — hide scrollbar, keep scroll.
- `.grad` — blue-purple gradient bg.

---

## 11. Conventions

1. Dashboard: MUI components + `theme.palette.*` — never hardcode brand hex; theme switching breaks.
2. Public pages: `nq-` prefixed classes inside `.nq` root; use CSS variables, not hex.
3. Tailwind for layout/spacing; brand colors via `customAll-*` etc.
4. One font: Baloo 2.
5. New colors → add to all three `_themes*-vars.scss` and `:export` block.
6. Known quirk: token named `backgound` (typo) — keep spelling; JS reads it.
