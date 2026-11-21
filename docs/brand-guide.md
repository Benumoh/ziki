# Ziki brand guide

> Colours, corners and components are set in [`docs/style-guide.md`](./style-guide.md), which wins where this page disagrees: the accent is now Ziki Blue (#0972D5), not teal.

The Zedu Amp dashboard (`https://metrics.zedu.chat/dashboard`) is a reference for tone. It is not a skin to copy. Ziki already has a light theme and a dark theme. Both stay. Teal stays the brand accent. Do not hard-code Amp’s hex colors onto components.

## Words that do not change

| Word | Means | Does not mean |
| --- | --- | --- |
| Organisation | The team. In code this is a Organisation. | A product, or Amp’s marketing organisation. |
| Project | One product inside a organisation. | A platform label, and not the whole team. |
| Platform | An issue label such as Web or Mobile. | A product. |

The Ziki mark stays the Ziki mark. Do not swap in the Amp bolt.

## What to borrow

These patterns have to work in both of Ziki’s themes. Use the existing slate, white, and teal Tailwind scales. Dark mode remaps those scales in `app/theme-dark.css`. Do not add a parallel Amp palette.

- **Calm page.** One column of content. Little decoration. No gradient headlines, no heavy drop shadows.
- **Quiet cards.** White (or the theme’s card surface) with a light border and a modest radius. The border does the work. No tinted card fills except a real success or warning state.
- **Title, then one line.** A page heading in the existing foreground color, with a short gray subtitle under it.
- **One primary action.** A teal pill. One per view. The header’s “New issue” is that action on signed-in pages.
- **Quieter secondary actions.** Bordered pills, no fill, same height as the primary. They do not compete with it.
- **Numbers you can scan.** Where a count already exists (points, a result total), set the figure in tabular numbers, heavier than its label.
- **Empty states are a sentence.** Say what is missing and what to do next. No illustration, no dashed poster.

## What not to take from Amp

- The dark purple sidebar (`#24145f`) and an always-light canvas. Ziki’s header stays a header. Light and dark still follow the theme toggle.
- Amp purple (`#7d68f9`, `#5b45e0`) as a brand or action color.
- Amp’s nav and product names: Overview, Marketing, Goals, Scoreboard, New goal, Create agent, Generate AI summary.
- Amp’s logo, chart styling, and five-up stat cards. Do not invent a metrics dashboard on the issues list. Stage counts on the current page are filters, not a scoreboard.
- A second “New issue” on the list. That action stays in the header.

## Where this shows up

- **Signed-in shell.** Existing header. Organisation dropdown on the left still lists organisations and switches on select. Points chip stays. Active nav item is a quiet teal pill. “New issue” is the one teal pill. Account and nav menus are bordered, not heavily shadowed.
- **Issues list.** Project name as the title, one subtitle, quiet bordered rows, empty copy as sentences.
- **Homepage.** Same title-and-subtitle hero, one teal pill, one quieter pill. The marketing sections stay; they do not grow an Amp sidebar.
- **Auth.** The existing card loses its shadow. The Google button is the shared secondary pill. Teal is unchanged.
