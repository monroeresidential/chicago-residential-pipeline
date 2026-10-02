-- ---------- helpers ----------
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- History for every record table. TG_ARGV = key columns. Refuses writes when app.actor is unset.
create function record_revision() returns trigger language plpgsql as $$
declare
  actor text := nullif(current_setting('app.actor', true), '');
  reason text := coalesce(nullif(current_setting('app.reason', true), ''), 'unspecified');
  old_j jsonb;
  new_j jsonb;
  rec jsonb;
  rid text;
  op text;
  v int;
begin
  if actor is null then
    raise exception 'app.actor is not set: run writes inside withActor()';
  end if;
  if tg_op = 'INSERT' then
    new_j := to_jsonb(new); rec := new_j; op := 'insert';
  elsif tg_op = 'DELETE' then
    old_j := to_jsonb(old); rec := old_j; op := 'delete';
  else
    old_j := to_jsonb(old); new_j := to_jsonb(new); rec := new_j;
    if (old_j - 'updated_at') = (new_j - 'updated_at') then
      return new;
    end if;
    op := case
      when old_j->>'deleted_at' is null and new_j->>'deleted_at' is not null then 'delete'
      when old_j->>'deleted_at' is not null and new_j->>'deleted_at' is null then 'restore'
      else 'update' end;
  end if;
  if reason like 'merge:%' then op := 'merge'; end if;
  select string_agg(rec->>k, ':' order by ord) into rid from unnest(tg_argv) with ordinality as t(k, ord);
  select coalesce(max(version), 0) + 1 into v from revisions where table_name = tg_table_name and record_id = rid;
  insert into revisions (table_name, record_id, version, op, before, after, actor, reason)
    values (tg_table_name, rid, v, op, old_j, new_j, actor, reason);
  return coalesce(new, old);
end $$;

-- ---------- history ----------
create table revisions (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  version int not null,
  op text not null check (op in ('insert', 'update', 'delete', 'restore', 'merge')),
  before jsonb,
  after jsonb,
  actor text not null,
  reason text not null,
  at timestamptz not null default now(),
  unique (table_name, record_id, version)
);

-- ---------- canonical shared values ----------
create table parcels (
  pin text primary key check (pin ~ '^[0-9]{14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table addresses (
  id bigint generated always as identity primary key,
  number_from int not null check (number_from > 0),
  number_to int not null,
  predir text check (predir in ('N', 'S', 'E', 'W')),
  street_name text not null,
  suffix text,
  zip text check (zip ~ '^[0-9]{5}$'),
  point geography(Point, 4326),
  merged_into_id bigint references addresses (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (number_to >= number_from),
  unique nulls not distinct (number_from, number_to, predir, street_name, suffix)
);
create index addresses_street on addresses (street_name, predir);
create index addresses_point on addresses using gist (point);

create table identifiers (
  id bigint generated always as identity primary key,
  type text not null check (type in ('permit_number', 'matter_key', 'record_number', 'elms_matter_id', 'dpd_app_no', 'zba_case_no')),
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, value)
);

create table organizations (
  id bigint generated always as identity primary key,
  name_key text not null unique,
  display_name text not null,
  merged_into_id bigint references organizations (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- records ----------
create table filings (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('permit', 'zoning_matter', 'hearing_item', 'zba_case')),
  source_key text not null,
  primary_address_id bigint references addresses (id),
  community_area int references community_areas (number),
  ward int check (ward between 1 and 50),
  units int check (units >= 0),
  status text,
  event_date date,
  in_target boolean not null,
  flag text,
  notes text,
  source_url text,
  attributes jsonb not null default '{}',
  field_sources jsonb not null default '{}',
  content_hash text not null,
  last_source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (kind, source_key)
);

create table projects (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  dpd_map_no int check (dpd_map_no between 1 and 25),
  name text,
  developer text,
  units int check (units > 0),
  units_source_filing_id bigint references filings (id),
  affordable_units int check (affordable_units >= 0),
  tpc_usd bigint check (tpc_usd > 0),
  program text not null check (program in ('lasalle', 'private')),
  public_support text,
  status text not null check (status in ('completed', 'under_construction', 'permitted', 'approved', 'planning')),
  status_note text not null check (status_note <> ''),
  flag text,
  confidence text not null check (confidence in ('dpd', 'reported')),
  built_by_3f_url text,
  point geography(Point, 4326) not null,
  sources text[] not null check (cardinality(sources) >= 1),
  notes text,
  visibility text not null default 'draft' check (visibility in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_point on projects using gist (point);

create table project_addresses (
  project_id text not null references projects (id),
  address_id bigint not null references addresses (id),
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (project_id, address_id)
);
create unique index project_primary_address on project_addresses (project_id) where is_primary;

create table filing_addresses (
  filing_id bigint not null references filings (id),
  address_id bigint not null references addresses (id),
  position int not null,
  primary key (filing_id, address_id)
);
create table filing_parcels (
  filing_id bigint not null references filings (id),
  pin text not null references parcels (pin),
  primary key (filing_id, pin)
);
create table filing_identifiers (
  filing_id bigint not null references filings (id),
  identifier_id bigint not null references identifiers (id),
  relation text not null check (relation in ('self', 'cited')),
  current boolean not null default true,
  primary key (filing_id, identifier_id, relation)
);
create index filing_identifiers_identifier on filing_identifiers (identifier_id);
create table filing_organizations (
  filing_id bigint not null references filings (id),
  organization_id bigint not null references organizations (id),
  role text not null check (role in ('applicant', 'owner', 'attorney', 'contractor', 'architect', 'other')),
  primary key (filing_id, organization_id, role)
);
create index filing_organizations_org on filing_organizations (organization_id);

create table project_filings (
  project_id text not null references projects (id),
  filing_id bigint not null references filings (id),
  role text not null check (role in ('zoning', 'hearing', 'permit', 'early_signal')),
  linked_by text not null,
  linked_at timestamptz not null default now(),
  reason text not null,
  primary key (project_id, filing_id)
);
create index project_filings_filing on project_filings (filing_id);

-- ---------- intake ----------
create table tokens (
  jti text primary key,
  sub text not null,
  role text not null check (role in ('submitter', 'editor')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

create table submissions (
  id bigint generated always as identity primary key,
  token_jti text not null references tokens (jti),
  idempotency_key text not null,
  body_sha256 text not null,
  body jsonb not null,
  response jsonb,
  received_at timestamptz not null default now(),
  unique (token_jti, idempotency_key)
);

create table queue_items (
  id bigint generated always as identity primary key,
  submission_id bigint not null references submissions (id),
  record_index int not null,
  kind text not null,
  source_key text not null,
  action text not null check (action in ('create', 'update')),
  proposed jsonb not null,
  content_hash text not null,
  diff jsonb not null default '{}',
  normalization_issues jsonb not null default '[]',
  suggestions jsonb not null default '{}',
  in_target boolean not null,
  has_flag boolean not null,
  has_blocking_issues boolean not null,
  top_strength text check (top_strength in ('strong', 'likely', 'possible')),
  address_display text,
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index queue_items_key on queue_items (kind, source_key, state);
create index queue_items_pending on queue_items (kind) where state = 'pending';

create table bulk_previews (
  code text primary key,
  action text not null check (action in ('approve', 'reject')),
  filter jsonb not null,
  item_ids bigint[] not null,
  link_strong boolean not null,
  reason text,
  created_by text not null,
  expires_at timestamptz not null
);

-- ---------- publishing and jobs ----------
create table site_state (
  id int primary key default 1 check (id = 1),
  dirty boolean not null default false,
  last_change_at timestamptz,
  last_build_requested_at timestamptz,
  last_published_at timestamptz
);
insert into site_state default values;

create table job_runs (
  name text not null,
  run_date date not null,
  at timestamptz not null default now(),
  primary key (name, run_date)
);

-- ---------- triggers ----------
create trigger parcels_updated before update on parcels for each row execute function set_updated_at();
create trigger addresses_updated before update on addresses for each row execute function set_updated_at();
create trigger identifiers_updated before update on identifiers for each row execute function set_updated_at();
create trigger organizations_updated before update on organizations for each row execute function set_updated_at();
create trigger filings_updated before update on filings for each row execute function set_updated_at();
create trigger projects_updated before update on projects for each row execute function set_updated_at();

create trigger parcels_history after insert or update or delete on parcels for each row execute function record_revision('pin');
create trigger addresses_history after insert or update or delete on addresses for each row execute function record_revision('id');
create trigger identifiers_history after insert or update or delete on identifiers for each row execute function record_revision('id');
create trigger organizations_history after insert or update or delete on organizations for each row execute function record_revision('id');
create trigger filings_history after insert or update or delete on filings for each row execute function record_revision('id');
create trigger projects_history after insert or update or delete on projects for each row execute function record_revision('id');
create trigger project_addresses_history after insert or update or delete on project_addresses for each row execute function record_revision('project_id', 'address_id');
create trigger filing_addresses_history after insert or update or delete on filing_addresses for each row execute function record_revision('filing_id', 'address_id');
create trigger filing_parcels_history after insert or update or delete on filing_parcels for each row execute function record_revision('filing_id', 'pin');
create trigger filing_identifiers_history after insert or update or delete on filing_identifiers for each row execute function record_revision('filing_id', 'identifier_id', 'relation');
create trigger filing_organizations_history after insert or update or delete on filing_organizations for each row execute function record_revision('filing_id', 'organization_id', 'role');
create trigger project_filings_history after insert or update or delete on project_filings for each row execute function record_revision('project_id', 'filing_id');
