# Ziki style guide

The one reference for Ziki's colours, corners and core components, in the app and on the public site. The values live as tokens in `app/globals.css` (and `app/theme-brand.css` for the blue ramp and dark mode), and in `components/homepage/homepage.css` for the public site. Use the tokens, not hex codes: a change here should be a change to one token.

## Colour

### Blue

One blue, in two strengths.

| Name | Hex | Token | Use |
| --- | --- | --- | --- |
| Ziki Blue | `#0972D5` | `--zk-blue` (`bg-zk-blue`, `text-zk-blue`), Tailwind `teal-500` / `blue` ramp 500 | The prominent blue: primary links in large text, accent words in headlines, focus rings, selected states, progress, blue fills with white text. |
| Light Blue | `#EEF8FF` | `--zk-tint`, `--zk-info-bg` (`bg-zk-tint`), ramp 50 | Light backgrounds: info banners, selected rows, highlighted chips. |
| Blue text | `#086CCC` | `--zk-accent` (`text-zk-accent`), `--zk-info-fg` | Small link and accent text. It is Ziki Blue a hair deeper so it passes 4.5:1 on white (5.2), the page gray (4.8) and Light Blue (4.8). Ziki Blue itself is 4.8 on white but 4.45 on Light Blue, so use Blue text for small text on tinted backgrounds. |

The full ramp (light theme, `app/theme-brand.css`; the `teal`, `violet` and `purple` Tailwind scales all map to it):

| 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `#EEF8FF` | `#D8EEFE` | `#B3DCFC` | `#7CC2F8` | `#3A9EF0` | `#0972D5` | `#0866C0` | `#0A57A3` | `#0D4885` | `#103B6B` | `#0B2646` |

Dark mode reverses the ramp (50 is the darkest), so the same class reads right in both themes.

### Neutrals

| Name | Hex | Token | Use |
| --- | --- | --- | --- |
| Black | `#161616` | `--zk-ink`, `--zk-text` (`text-zk-text`, `bg-zk-ink`) | Body text and headings; key chips (the small black keycap inside a button, as in **CONTACT `C`**). |
| Dark Gray | `#3D3D3D` | `--zk-primary` (`bg-electric-blue-strong`, `Button` default) | Filled buttons, with white text (11:1). Hover goes to Black. |
| Text 2 | `#384152` | `--zk-text2` | Secondary text. |
| Muted | `#686868` | `--zk-muted` | Labels, timestamps, hints. |
| Border | `#E8E8E8` | `--zk-border` | Panel and control edges. |
| Divider | `#F0F0F0` | `--zk-divider` | Lines inside a panel. |
| Page | `#F5F5F5` | `--zk-bg` | The page behind panels. |
| Surface | `#FFFFFF` | `--zk-surface` | Panels and cards. |

In dark mode filled buttons are Ziki Blue (a dark gray button disappears on a dark page); the rest of the neutrals are remapped in `app/theme-brand.css`.

### Status

Green, red and amber stay as they are: `--zk-ok-*`, `--zk-bad-*`, `--zk-warn-*`. Use them only for real states (passed, failed, needs attention), never as decoration.

## Corners

One scale, everywhere. Tailwind's own steps are remapped to it in `app/globals.css`, so `rounded-xl` is always a control and `rounded-2xl` always a panel.

| Size | Token / class | Use |
| --- | --- | --- |
| 12px | `rounded-panel` (= `rounded-2xl`) | **The panel radius.** Panels, cards, dialogs, popovers, the chat sheet, image frames. |
| 10px | `rounded-control` (= `rounded-xl`) | Buttons, inputs, selects, segmented controls, menus' items. |
| 8px | `rounded-lg` | Small controls inside a panel (icon buttons, small toggles). |
| 6px | `rounded-chip` (= `rounded-md`) | Chips, tags, key chips, small badges. |
| 4px | `rounded-sm` | Tiny marks (progress segments, code highlights). |
| full | `rounded-full` | Avatars, status dots, count pills, the audience toggle and the badge above the homepage headline. |
| 16px | `rounded-3xl` | Only a full-screen sheet's top edge; not for ordinary panels. |

Don't write pixel radii (`rounded-[20px]`) in components. If a new shape needs a new radius, add a token here first.

On the public site the same values are `--panel-radius` (12px) and `--button-radius` (10px) in `homepage.css`.

## Buttons

**All buttons are flat.** A solid fill or a thin line, never a shadow, gradient, glow, inner highlight, lift on hover or shrink on press. Hover changes only the fill (or the line); focus is the blue ring. In the app use `Button` (`components/ui/button.tsx`) and `TOOL_BUTTON` (`lib/ui-style.ts`) rather than writing button classes by hand.

| Variant | `Button variant` | Fill | Text | Line | Hover | Use |
| --- | --- | --- | --- | --- | --- | --- |
| Primary | `primary` (default) | Dark Gray `#3D3D3D` | White | none | Black `#161616` | The main action. One per view. |
| Accent | `accent` | Ziki Blue `#0972D5` | White | none | `#0866C0` | The one call to action on a public page (the homepage hero). Not for app actions. |
| Secondary | `secondary` | Surface | Black | 1px Border | Chip gray | Every other action beside a primary. |
| Ghost | `ghost` | none | Text 2 | none | Chip gray | Low-stakes actions in toolbars and menus. |
| Danger | `danger` / `danger-secondary` | Red / Surface | White / red | — / red line | Darker red | Destructive actions, behind a confirmation. |
| Toolbar | `TOOL_BUTTON` | Surface | Black | 1px Border | Chip gray | Filter, period pickers, "New …" in toolbars. On (a filter picked): Light Blue fill, Blue text. |

Shape and size, the same for every variant:

- **Corners 10px** (`rounded-control`). Only icon-only round buttons (avatars, a close ×) are fully round.
- **Height 36px** (`h-9`), 16px side padding, 14px semibold text. Large marketing buttons may be 44–48px; never taller.
- **Key chip** (optional, as in **CONTACT `C`**): Black fill, 6px corners, white monospace letter, inside the button on the right.
- **Icon** (optional): 16px, 8px before the label.
- **Disabled**: 50% opacity, no hover.

Floating controls that sit over the page (the report button, the guide bubble, the agent dock) may keep a soft shadow, because they float; buttons in the page never do.

## Other components

- **Panel.** Surface, 1px Border, 12px corners, no shadow in the app. The public site may lift a product picture with a soft shadow.
- **Info banner.** Light Blue background, Blue text, 12px corners.
- **Link.** Blue text; underline on hover.
- **Focus.** A 2px Ziki Blue ring (`ring-electric-blue`), offset 2px.

## Type

**Ziki uses one font family: Geist.** Geist for all text, everywhere (the app, the homepage, the marketing pages, emails). Its companion, Geist Mono, is the only second font. Both are loaded once in `app/layout.tsx` (from `app/fonts/`) as `--font-geist` and `--font-geist-mono`; Tailwind's `font-sans` and `font-mono` point at them. Don't add another font, and don't load one from a CDN.

| Font | Token | Use |
| --- | --- | --- |
| **Geist** | `--font-geist` (`font-sans`, the default) | Everything you read: headlines, body text, nav, buttons, labels, small caps eyebrows. |
| **Geist Mono** | `--font-geist-mono` (`font-mono`) | Only what is data: code and diffs, ids and keys (`#412`, `award_bid`), API names, figures in tables and timestamps. Never nav links, buttons or headings. |

Sizes and weights:

| Role | Size | Weight | Letter spacing |
| --- | --- | --- | --- |
| Hero headline (public pages) | 36–68px (`clamp`) | 500 | −0.045em |
| Section headline | 28–44px | 600 | −0.04em |
| Panel or card title | 16–20px | 600 | −0.01em |
| Body | 15–17px, line height 1.5 | 400 | 0 |
| Nav links, buttons | 14–15px | 500–600 | −0.01em |
| Labels, meta | 12–13px | 500 | 0 |
| Eyebrow (small caps label) | 11–12px, uppercase | 600 | 0.06–0.08em |
| Footer | links 14px, headings 15px, fine print 13px | 400 / 600 | 0 |

Keep every piece of text at 11px or larger, and body text at 14px or larger.
