ALTER TABLE items ADD COLUMN next_actor TEXT CHECK(next_actor IN ('user','codex'));
ALTER TABLE items ADD COLUMN next_action TEXT NOT NULL DEFAULT '' CHECK(length(next_action)<=2000);
ALTER TABLE items ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(acceptance_criteria) AND json_type(acceptance_criteria)='array' AND json_array_length(acceptance_criteria)<=50);
-- The persisted 'testing' status is retained; its display name is Ready for Review.
