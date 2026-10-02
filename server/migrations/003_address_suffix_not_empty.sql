-- A street without a suffix is NULL, never '' (two spellings of "none" would defeat the unique index).
alter table addresses add constraint addresses_suffix_not_empty check (suffix <> '');
