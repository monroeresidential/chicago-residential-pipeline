-- 'sending' while an alert email is in flight, 'sent' once delivered; a stale 'sending' claim is retried.
alter table job_runs add column status text not null default 'sent' check (status in ('sending', 'sent'));
