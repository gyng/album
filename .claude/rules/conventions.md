---
description: Project-wide coding and style conventions
---

- **British English** in all user-facing copy and comments: colour, centre, favourite, licence, etc.
- CSS Modules only — no inline styles except for dynamic values (colours, widths derived from data)
- No `classnames`/`clsx` — use `.filter(Boolean).join(" ")` for conditional class lists
- Omit optional attributes/props rather than setting them to `undefined`
- Components have co-located `.module.css` files; `.test.tsx` files exist for complex components but not all
