-- Set when an item's diff is refreshed against a changed filing; approving it then requires the refreshed base_hash.
alter table queue_items add column refreshed boolean not null default false;
