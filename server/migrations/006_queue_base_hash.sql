-- The accepted filing's content hash an update item was diffed against; approval requires it to be unchanged.
alter table queue_items add column base_hash text;
