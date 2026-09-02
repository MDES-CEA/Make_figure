# Interface principles

This checklist is the acceptance gate for interface changes. The application is a materials-science instrument: the interface may carry a material identity, but the figure and the export path stay neutral.

## Scope of the visual identity

The interface is split into two zones with different rules.

- **Chrome** — top bar, side panels, tool panels, status bar, welcome screen, empty states, loaders, dialogs. Material treatment is allowed here under the constraints below.
- **Figure zone** — the page stage, the plotted figure, the export preview and everything written into an exported file. No texture, no tint, no animation, no chrome accent. The rendered figure must be identical on screen and in the exported PNG, TIFF, SVG and PDF.

## Content

- A subtitle or description must add a constraint, consequence, state or next action that is not already present in the heading.
- Do not repeat the active project, workspace or selected item in adjacent interface elements.
- Avoid generic marketing claims, inflated adjectives, fake metrics, testimonials and urgency.
- Use domain terminology. Avoid vague labels such as "magic", "smart", "enhance" or "AI-powered".
- Empty states should state the required action and accepted input, not advertise the product.

## Visual design

- Use one accent pigment per analysis workspace. The pigment marks the active workspace, the current selection, focus and the primary action. It is not a page tint and is not used to colour large surfaces.
- A single material texture may cover the chrome background. It must be procedural or a static asset under 8 kB, monochrome, non-interactive, and its effective contrast against the underlying surface must stay at or below 6 %. One texture layer per screen.
- Decorative geometry is allowed when it is derived from the domain — nucleation, growth, stratification, diffraction — and it must never sit between the user and a control. Multicolour gradients, glass blur, particle fields with no domain meaning, and glow used to suggest importance remain excluded.
- Shadows are limited to true elevation: figures, menus, dialogs and transient notifications. A cast shadow is not a hover affordance.
- Corner treatment is a hierarchy signal: one geometry for surfaces, one for the primary action. Do not apply the same radius to every container, and do not turn every group into a card. Borders, seams and spacing establish hierarchy before containers do.
- Keep the canvas dominant. Side panels must have an explicit task and must not leave an arbitrary empty column.
- Each context should have one visually dominant action at most.

## Motion

- Motion communicates a state change, progress or a spatial relationship. State transitions stay at or below 200 ms.
- One orchestrated sequence is allowed per application start, on the welcome screen only, capped at 1 200 ms and skipped once a project is loaded. There is no second entrance animation elsewhere.
- Continuous background motion is allowed only on the welcome screen and empty states, must stop or idle once data is present, and must not run while a figure is on screen.
- `prefers-reduced-motion: reduce` disables every non-essential animation, including the welcome sequence and any background motion. Reduced motion is an accessibility setting, not a visual theme.
- Nothing in the figure zone animates.

## Features and controls

- A new feature requires a named user task, representative input and a testable completion condition.
- Prefer extending an existing workflow over adding another panel, mode, preset or parallel control path.
- Do not add themes, display modes or preferences without a demonstrated scientific or accessibility requirement. A light chrome variant qualifies when it is justified by ambient-light legibility, not by taste.
- Advanced scientific controls remain collapsed until they are relevant to the current data or selection.
- Every persistent setting needs a clear reset path and must survive session save/restore when appropriate.
- Prototype-only, disabled and unfinished controls do not ship in the production interface.

## Interaction and accessibility

- Icon-only controls require an accessible name and a tooltip.
- Form controls require visible labels; placeholder text is not a label.
- Focus, selection, disabled and error states must remain distinguishable without relying on colour alone. Selection is marked by a shape change — a seam, a tick, a notch — in addition to the pigment.
- Body text keeps a contrast ratio of at least 4.5:1 and secondary text at least 3:1 against its own surface, texture included.
- Duplicate controls that modify the same state must remain synchronised or be consolidated.

## Implementation

- Remove superseded CSS instead of appending another override layer.
- Run `npm run lint:css` when modifying the stylesheet; the check rejects top-level declarations superseded by the same selector later in the file.
- Split components when one file combines unrelated data processing, storage, export and interface responsibilities.
- Keep scientific calculations independent from rendering components and cover them with focused tests.
- Reuse the design tokens and existing components; do not introduce one-off colours, spacing or interaction patterns. A new pigment is a token, not a literal.
- Textures and generated geometry are produced in code from documented parameters, not pasted as opaque data blobs.
- Delete abandoned experiments, unused selectors and unused state when a direction is rejected.

## Current structural debt

The interface cleanup does not by itself resolve three existing maintenance risks:

- `src/App.jsx` combines application state, import/export, scientific workflows and most interface rendering in one large component.
- Translation keys are primarily French source strings rather than stable semantic identifiers.
- The production build currently places most application code in a single JavaScript bundle, which limits incremental loading.

These items should be reduced incrementally behind tests. They are code-maintenance issues rather than reasons to add another visible redesign.
