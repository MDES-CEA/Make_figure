# Interface principles

This checklist is the acceptance gate for interface changes. It is intended to keep the application focused on scientific figure preparation rather than decorative product conventions.

## Content

- A subtitle or description must add a constraint, consequence, state or next action that is not already present in the heading.
- Do not repeat the active project, workspace or selected item in adjacent interface elements.
- Avoid generic marketing claims, inflated adjectives, fake metrics, testimonials and urgency.
- Use domain terminology. Avoid vague labels such as “magic”, “smart”, “enhance” or “AI-powered”.
- Empty states should state the required action and accepted input, not advertise the product.

## Visual design

- Use one functional accent per analysis workspace. Accent colour indicates selection, focus or a primary action; it is not a page tint.
- Do not use decorative halos, glow, particles, shimmer, glass effects or multicolour gradients.
- Motion must communicate a state change, progress or spatial relationship. Decorative floating, breathing, orbiting and entrance animations are excluded.
- Shadows are limited to true elevation: figures, menus, dialogs and transient notifications.
- Avoid turning every group into a rounded card. Borders and spacing should establish hierarchy before containers do.
- Keep the canvas dominant. Side panels must have an explicit task and must not leave an arbitrary empty column.
- Each context should have one visually dominant action at most.

## Features and controls

- A new feature requires a named user task, representative input and a testable completion condition.
- Prefer extending an existing workflow over adding another panel, mode, preset or parallel control path.
- Do not add themes, display modes or preferences without a demonstrated scientific or accessibility requirement.
- Advanced scientific controls remain collapsed until they are relevant to the current data or selection.
- Every persistent setting needs a clear reset path and must survive session save/restore when appropriate.
- Prototype-only, disabled and unfinished controls do not ship in the production interface.

## Interaction and accessibility

- Icon-only controls require an accessible name and a tooltip.
- Form controls require visible labels; placeholder text is not a label.
- Focus, selection, disabled and error states must remain distinguishable without relying on colour alone.
- Reduced motion is an accessibility setting, not a visual theme.
- Duplicate controls that modify the same state must remain synchronised or be consolidated.

## Implementation

- Remove superseded CSS instead of appending another override layer.
- Run `npm run lint:css` when modifying the stylesheet; the check rejects top-level declarations superseded by the same selector later in the file.
- Split components when one file combines unrelated data processing, storage, export and interface responsibilities.
- Keep scientific calculations independent from rendering components and cover them with focused tests.
- Reuse the design tokens and existing components; do not introduce one-off colours, spacing or interaction patterns.
- Delete abandoned experiments, unused selectors and unused state when a direction is rejected.

## Current structural debt

The interface cleanup does not by itself resolve three existing maintenance risks:

- `src/App.jsx` combines application state, import/export, scientific workflows and most interface rendering in one large component.
- Translation keys are primarily French source strings rather than stable semantic identifiers.
- The production build currently places most application code in a single JavaScript bundle, which limits incremental loading.

These items should be reduced incrementally behind tests. They are code-maintenance issues rather than reasons to add another visible redesign.
