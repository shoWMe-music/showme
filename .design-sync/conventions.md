## Building with the shoWMe design system

shoWMe is a **dark-first** live-events booking + settlement UI kit. Warm near-black grounds, a coral-red
(`--brand-red` #EE5746) → gold (`--brand-gold`) accent, Clash Display headings over Inter Tight body.

### Setup — one stylesheet, dark by default
Link **`styles.css`** once; it carries the design tokens, the CDN web fonts, and every component's styles.
All tokens live at `:root` on the **dark** theme, so components are on-brand with no provider. For a light
surface, set `data-theme="light"` on an ancestor (`<html data-theme="light">` or any wrapper div).

The **only** wrapper you ever need is for toasts: mount `<ToastProvider>` near the root and call `useToast()`
inside it — `const toast = useToast(); toast.success("Settlement sent")`. Everything else is self-contained.

### Styling idiom — props, then tokens (there are NO utility classes)
Components are styled through their **props** (`variant`, `status`, `size`, `tone`, …), not class names — this DS
ships no `bg-*`/`p-*` utility vocabulary. For your own layout glue, style with the **CSS variables**:

- Surfaces: `var(--bg)`, `var(--surface)`, `var(--elevated)`, `var(--card)`
- Text: `var(--text)`, `var(--muted)`, `var(--dim)`; accent `var(--accent)`; brand `var(--brand-red)`, `var(--brand-gold)`
- Lines & depth: `var(--border)`, `var(--border-strong)`, `var(--shadow)`, `var(--shadow-lg)`, `var(--focus)`
- Type: `var(--font-display)` (Clash Display — headings), `var(--font-sans)` (Inter Tight — body),
  `var(--font-serif)` (Instrument Serif — italic accents), `var(--font-mono)` (JetBrains Mono — eyebrows/labels)

Never hard-code a hex, font, or radius a token already carries.

### Components (all `import { … } from "@showme/design-system"`)
- **Actions & inputs:** `Button` (variant primary/secondary/ghost/cta), `Toggle`, `Checkbox`, `Input`,
  `SearchInput`, `TextField`, `SelectCard`
- **Status & labels:** `Badge`, `Tag`, `Chip`, `StatusDot`, `Avatar`, `ProgressBar`, `Spinner`, `Skeleton` —
  status colors come from the shared `Status` union (`STATUSES`, `STATUS_LABEL`)
- **Surfaces & layout:** `Card`, `SectionHeader`, `StatCard`, `KeyValueRow`, `ListRow`, `EmptyState`, `Stepper`,
  `Tabs`, `SidebarItem`, `Modal`, `Toast`/`ToastProvider`/`useToast`
- **Domain:** `ContactCard`, `DataTable` (columns via `DataTableColumn[]`)
- **Icons:** `<Icon name="check" size={16} />` — `name` is the `IconName` union.

### A typical screen
```tsx
import { SectionHeader, StatCard, Card, Button, Icon } from "@showme/design-system";

<div style={{ padding: 28, display: "grid", gap: 20, background: "var(--bg)", color: "var(--text)" }}>
  <SectionHeader
    eyebrow="This month"
    title="Your roster, in one place"
    subtitle="Represented artists, their agreements, and deals in flight."
    actions={<Button variant="primary" leftIcon={<Icon name="plus" />}>Add artist</Button>}
  />
  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
    <StatCard label="Total settlement" value="€48,200" hint="Across 6 events" />
    <StatCard label="Deals in flight" value="12" hint="3 awaiting confirm" />
    <StatCard label="Represented artists" value="8" />
  </div>
  <Card padding="lg">…</Card>
</div>
```
