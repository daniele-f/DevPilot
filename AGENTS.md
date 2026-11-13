# DevPilot project preferences

- Do not open or control browsers, request Firefox or other browser access, or perform manual, visual frontend/UI verification unless the user explicitly requests an exception.
- The user owns frontend interaction, visual acceptance testing, and frontend test suites. Do not independently run frontend test suites without an explicit request.
- Automated noninteractive code and backend checks, builds, and static checking are allowed. These permissions do not override the restriction on frontend test suites.
- When implementation and permitted checks are complete, move the card to Ready for Review (`testing`), set the next actor to the user, and provide concise steps for their testing. Do not block completion on browser verification.
- Do not mark cards Done before the user explicitly tests and accepts the result.
- Keep card notes short, readable, and specific to the card. Prefer clear paragraphs over technical run-on summaries.
- Every time Codex works on or moves a card, leave a Codex-authored note on that card explaining what was done, what was learned, any information still needed or blockers, and the next step as relevant. This applies to investigation and clarification as well as implementation and handoff; a chat reply alone is not enough.
