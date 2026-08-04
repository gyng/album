---
description: Project-wide coding and style conventions
---

- **British English** in all user-facing copy and comments: colour, centre, favourite, licence, etc.
- **Copy earns its place.** User-facing text must say something the interface cannot: no
  instructions for interactions a reader discovers by trying (a picture that turns by itself does
  not need "drag to turn it"), no caption restating what is beside it, no section description
  paraphrasing its own title. If a sentence can be deleted without losing information, delete it —
  prefer nothing to filler
- CSS Modules only — no inline styles except for dynamic values (colours, widths derived from data)
- No `classnames`/`clsx` — use `.filter(Boolean).join(" ")` for conditional class lists
- Omit optional attributes/props rather than setting them to `undefined`
- Components have co-located `.module.css` files; `.test.tsx` files exist for complex components but not all
