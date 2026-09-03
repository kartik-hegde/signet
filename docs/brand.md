---
title: Signett Signal design kit
description: The visual and verbal system for Signett websites, product interfaces, diagrams, and materials.
aside: false
sidebar: false
outline: [2, 3]
---

<div class="brand-page">
  <div class="brand-kicker">Signett Signal / Design kit 01</div>
  <div class="brand-principle">Quiet infrastructure.<br>Visible proof.</div>

  <p>This is Signett’s shared language for websites, product UI, documentation, decks, reports, diagrams, and launch materials. It should feel calm, technical, exact, and unmistakably made by people who care about the last five percent.</p>

  <div class="brand-rule">
    <div><strong>Quiet by default</strong><p>Paper, ink, space, and hairlines do most of the work. Restraint creates confidence.</p></div>
    <div><strong>Precise in structure</strong><p>Visible grids, compact labels, and code-native diagrams make the system feel engineered.</p></div>
    <div><strong>Alive at the edge</strong><p>Color marks state changes, active paths, and proof. It is information, never decoration.</p></div>
  </div>
</div>

## 1. Color

The default ratio is **90% neutral / 8% structure / 2% signal**. Use one accent in a
composition; use multiple accents only for data or a process diagram where each color has
a stable meaning.

<div class="brand-swatches">
  <div class="brand-swatch" style="--swatch:#FFFFFF">PAPER<span>#FFFFFF</span></div>
  <div class="brand-swatch" style="--swatch:#171714;--swatch-text:#FFFFFF">INK<span>#171714</span></div>
  <div class="brand-swatch" style="--swatch:#DCDCD3">LINE<span>#DCDCD3</span></div>
  <div class="brand-swatch" style="--swatch:#E85D2A;--swatch-text:#171714">SIGNAL<span>#E85D2A</span></div>
  <div class="brand-swatch" style="--swatch:#4169E1;--swatch-text:#FFFFFF">CALL<span>#4169E1</span></div>
  <div class="brand-swatch" style="--swatch:#2D9B68;--swatch-text:#171714">PROOF<span>#2D9B68</span></div>
</div>

| Token  | Meaning        | Use                                       |
| ------ | -------------- | ----------------------------------------- |
| Paper  | workspace      | Default canvas, slides, documents         |
| Ink    | authority      | Type, primary actions, key diagrams       |
| Line   | structure      | Rules, grids, tables, boundaries          |
| Signal | attention      | Active path, CTA hover, important change  |
| Call   | invocation     | Inputs, requests, agent activity          |
| Proof  | verified state | Success only after authoritative evidence |

Amber (`#D99918`) means pending or replayed. Red (`#C74440`) means stopped or failed.
Never use Proof green to mean merely “submitted.”

## 2. Typography

Use a three-voice stack. The serif explains the idea, sans-serif runs the interface, and
monospace names the machinery. All three should appear in major brand compositions, but
never compete at the same size.

<div class="type-specimen">
  <div class="brand-label">Display / Charter</div>
  <div class="type-display">Interfaces agents can trust.</div>
</div>
<div class="type-specimen">
  <div class="brand-label">UI / Inter</div>
  <div class="type-ui">Expose a production action and inspect its complete lifecycle.</div>
</div>
<div class="type-specimen">
  <div class="brand-label">Code / SF Mono</div>
  <div class="type-code">verify({ input, output, context }) → true</div>
</div>

**Production font set:** Charter (editorial), Inter (interface), and SF Mono or IBM Plex
Mono (code). For editable office materials, use Georgia, Arial, and Consolas as safe
substitutes. Set display type at 0.95–1.08 line height; body at 1.55–1.75; labels in
uppercase with generous tracking.

## 3. Layout and geometry

Build on an 8 px rhythm, with 4 px allowed for optical correction. Prefer large zones of
empty space and thin dividers over cards inside cards.

- **Web:** 12-column grid, 1120 px content width, 720 px reading width.
- **Slides:** 12-column grid, 64 px outer margin, one idea per slide.
- **Documents:** generous top margin, 65–75 characters per line, rules instead of fills.
- **Corners:** 4 px controls, 8 px code and panels, 14 px only for large containers.
- **Depth:** borders first, tonal fill second, shadow almost never.

## 4. Components

<div class="component-canvas">
  <div class="component-cell">
    <div class="brand-label">Actions</div>
    <a class="kit-button" href="#">Run check →</a>
    <a class="kit-button secondary" href="#">View trace</a>
  </div>
  <div class="component-cell">
    <div class="brand-label">Verified state</div>
    <div class="kit-status">outcome_verified</div>
  </div>
  <div class="component-cell">
    <div class="brand-label">Callout</div>
    <div class="kit-callout"><strong>Authoritative result</strong><p>The application state confirms this action completed.</p></div>
  </div>
  <div class="component-cell">
    <div class="brand-label">Code language</div>
    <div class="type-code" style="margin-top:22px">01&nbsp; expose<br>02&nbsp; execute<br><span style="color:var(--sg-signal)">03&nbsp; verify</span><br>04&nbsp; observe</div>
  </div>
  <div class="component-cell wide">
    <div class="brand-label">Process / active color follows the evidence</div>
    <div class="signal-flow">
      <div class="signal-step">agent intent</div>
      <div class="signal-step">tool call</div>
      <div class="signal-step active">application effect</div>
      <div class="signal-step">verified outcome</div>
    </div>
  </div>
</div>

Primary actions begin in Ink, not Signal. Signal appears on hover, selection, or the one
moment a story needs attention. Status pills are compact, lowercase, and factual. Avoid
soft marketing gradients, glass effects, oversized corner radii, and decorative shadows.

## 5. Diagram language

Diagrams are a signature asset, not decoration. Draw them as if they could be a debugging
view: one-pixel lines, square or circular nodes, brief monospace labels, and a clearly
traceable path.

```text
function ── call ── boundary ── effect ── proof
   blue         amber        signal       green
```

- Left to right means execution; top to bottom means detail or recovery.
- Dashed lines indicate a planned or optional relationship, never a completed one.
- Empty nodes are pending. Filled nodes are observed. Green requires verification.
- Use no more than five nodes in marketing; technical documentation may be denser.

## 6. Voice

Write like a careful engineer speaking to another capable person. Lead with the outcome,
name the boundary, and state limitations without apology.

| Prefer                                        | Avoid                                 |
| --------------------------------------------- | ------------------------------------- |
| “Know the action really happened.”            | “Revolutionize your agentic journey.” |
| “Add controls when the action warrants them.” | “Enterprise-grade by default.”        |
| “Verified against application state.”         | “Guaranteed safe.”                    |
| `Expose → Prove → Observe`                    | Long strings of abstract nouns        |

Use sentence case everywhere except compact navigational labels and diagrams. Use verbs
for buttons. Product claims should point to code, a trace, a benchmark, or an observed
outcome.

## 7. Application rules

<div class="usage-grid">
  <div class="usage-card do"><strong>DO / create hierarchy with space</strong><p>Let one serif statement own the page. Use labels and rules to reveal its structure.</p></div>
  <div class="usage-card dont"><strong>DON’T / fill every surface</strong><p>A page should not look like a dashboard unless the information truly behaves like one.</p></div>
  <div class="usage-card do"><strong>DO / make color carry state</strong><p>Keep meanings stable across the website, product, documentation, decks, and reports.</p></div>
  <div class="usage-card dont"><strong>DON’T / use a rainbow as atmosphere</strong><p>If removing a color loses no information, remove the color.</p></div>
  <div class="usage-card do"><strong>DO / show real artifacts</strong><p>Prefer code, traces, tables, and technical diagrams over generic AI illustration.</p></div>
  <div class="usage-card dont"><strong>DON’T / cosplay a terminal</strong><p>The system is developer-native because it is precise, not because everything is black and monospace.</p></div>
</div>

## 8. Fast recipes

### Website

Paper canvas, hairline navigation, one editorial headline, compact monospace eyebrow, one
Ink CTA, and one technical proof artifact. Reserve Signal for the active part of the story.

### Deck

Off-white background; page number and section in 10–11 pt mono; headline in 30–44 pt
serif; body in 16–20 pt sans. One colored diagram or one Signal sentence per slide—not both.

### Report or memo

Black type on Paper, narrow measure, sparse tables with horizontal rules, and no colored
heading bars. Use Signal for decisions and Proof for findings backed by evidence.

### Social card

One statement, one small process diagram, the Signett wordmark, and substantial empty space.
Never shrink a full webpage into the frame.

## 9. Design checklist

- Can the composition survive in grayscale?
- Does every color communicate something specific?
- Is there one obvious idea before the details begin?
- Are code and evidence real rather than decorative?
- Are boundaries shown with spacing or a hairline before using a filled container?
- Does success mean verified success?
- Would removing one-third of the styling improve it? If yes, do that.
