-- The approved queue item a filing's accepted source came from (stable reference for recomputing last_source_hash).
alter table filings add column source_item_id bigint references queue_items (id);
