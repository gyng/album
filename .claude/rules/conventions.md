---
description: Project-wide coding and style conventions
---

- **British English** in all user-facing copy and comments: colour, centre, favourite, licence, etc.
- CSS Modules only — no inline styles except for dynamic values (colours, widths derived from data)
- No `classnames`/`clsx` — use `.filter(Boolean).join(" ")` for conditional class lists
- Omit optional attributes/props rather than setting them to `undefined`
- Each component has a co-located `.module.css` and `.test.tsx` in the same directory
