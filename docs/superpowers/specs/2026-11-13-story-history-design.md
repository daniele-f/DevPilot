# Story history — approved design

Card 10000007 records who changed a story, when, and the before/after values. Events appear chronologically between notes as compact muted activity lines with an icon and timestamp, without note bubbles or edit/delete actions. The user approved this design in chat.

Follow-up feedback (2026-11-13): do not display change values or expandable details. Keep short activity messages only, including a generic lane-move message. A deleted-note event is visible only to its deleting user and is labelled “Only visible to me”. Enforce identity privacy in local history reads (including MCP) and hosted RLS, rather than just hiding rows in the UI. Older local deletion events without a recorded identity remain hidden because the deleting identity cannot be verified.

Further feedback (2026-11-13): note editing must not create history; use an “Edited” label on the note itself, backed by a persisted edited timestamp carried through live updates. Hide legacy note-edit history too. Lane, next actor and next action events show the new value only; retain no before/after detail controls. Empty actor/action destinations display Unassigned/cleared. Private deletion behavior stays unchanged.

Further feedback: a user may remove their own deleted-note history using a small right-aligned × visible on hover/focus (always available on touch), without confirmation. Enforce ownership and deleting identity in the backend; other history stays protected. Dismissing history produces no replacement event and refreshes other open cards through existing invalidations.

Further feedback: removed-note history occupies the original note's chronological position. Persist note_id and note_created_at on deletion; sort using that original timestamp and note ID for stable equal-time ordering, while still displaying removal time. Recover older local positions from retained note events only when exactly one original note matches; unavailable or ambiguous originals retain their existing fallback position.

Persist creation, saved field/checklist changes, archive/restore, and note edit/removal. Note creation is represented by the note itself. Begin at rollout; do not invent historical events. Record events atomically with writes, including MCP writes, and preserve existing draft/live-update behavior.

Approach: database triggers maintain a separate append-only activity table; repositories read it and the card merges it with notes. Client-only logging would miss MCP and other writers; storing events as notes would violate the approved presentation and editing rules.

Implementation choices: retain full old/new values, offer expandable details for long text/checklists, use existing ownership rules and live invalidations. Local MCP writes identify Codex through a transaction-scoped writer context; hosted authenticated app writes identify Me, other database writers identify System unless attributable.

No browser verification or frontend test suites. Run backend, database and build checks, then hand off in Ready for Review. Existing unrelated workspace changes stay intact.
