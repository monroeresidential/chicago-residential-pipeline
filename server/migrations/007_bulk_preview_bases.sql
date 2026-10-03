-- The base_hash each previewed item had when the preview was made; a confirm approves an item only if unchanged.
alter table bulk_previews add column item_bases jsonb not null default '{}';
