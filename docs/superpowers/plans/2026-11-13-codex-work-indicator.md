# Codex work indicator

Goal: Show the approved combination of a compact status beside the story ID and run details above the note composer.

Use the existing CodexRunPanel polling state for both locations. Keep its questions, approvals and work controls together above the composer; show a spinner only for starting/running, and text for waiting and terminal states. Respect reduced motion. No backend or connection changes.

- Add a signal view query in ItemPanel for the existing run panel and render its status in the fixed header.
- Move the run panel above the note composer and add a current activity explanation.
- Add compact wrapping status styles and reduced-motion spinner styling.
- Run the production build and TypeScript checks. Frontend tests and visual acceptance belong to the user.
