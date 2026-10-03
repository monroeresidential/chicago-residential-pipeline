-- Counts publish-affecting changes, so a rebuild only clears "dirty" if nothing changed while its hook ran.
alter table site_state add column change_seq bigint not null default 0;
