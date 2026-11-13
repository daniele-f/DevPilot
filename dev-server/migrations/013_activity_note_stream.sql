-- Early development builds published history through board revisions. Notes
-- already deliver their own stream events; keep their history on that path.
drop trigger if exists activity_live;
