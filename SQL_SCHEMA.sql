create extension if not exists "pgcrypto";

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),

  period_key text,
  tahsilat_period_key text,
  fatura_period_key text,

  import_batch_id text,
  source_file_name text,

  sira integer default 0,

  vkn text,
  unvan text,
  dagitici text,
  bayi text,

  fatura_no text,
  fatura_tarihi date,
  fatura_tutari numeric default 0,

  tahsilat_durumu text,
  tahsilat_tarihi date,

  toplam_tutar numeric default 0,

  raw_data jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.imports (
  period_key text primary key,

  last_file_name text,
  last_import_batch_id text,
  last_uploaded_by text,

  last_import_row_count integer default 0,

  updated_at timestamptz default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),

  import_batch_id text unique,
  period_key text,

  file_name text,
  row_count integer default 0,

  uploaded_by text,

  created_at timestamptz default now()
);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.send_logs (
  id uuid primary key default gen_random_uuid(),

  bayi text,
  email text,
  period_key text,
  import_batch_id text,
  durum text,
  detail text,

  created_at timestamptz default now()
);

insert into public.system_settings (key, value, updated_at)
values (
  'bayi_data_version',
  jsonb_build_object('version', 0, 'reason', 'initial_schema', 'updatedAt', now()::text),
  now()
)
on conflict (key) do nothing;

create index if not exists idx_payment_records_tahsilat_period
  on public.payment_records(tahsilat_period_key);

create index if not exists idx_payment_records_fatura_period
  on public.payment_records(fatura_period_key);

create index if not exists idx_payment_records_import_batch
  on public.payment_records(import_batch_id);

create index if not exists idx_payment_records_bayi
  on public.payment_records(bayi);

create index if not exists idx_payment_records_tahsilat_tarihi
  on public.payment_records(tahsilat_tarihi);

create index if not exists idx_payment_records_customer_analytics
  on public.payment_records(dagitici, bayi, vkn, tahsilat_tarihi);

create index if not exists idx_send_logs_created_at
  on public.send_logs(created_at);

alter table public.payment_records enable row level security;
alter table public.imports enable row level security;
alter table public.import_batches enable row level security;
alter table public.system_settings enable row level security;
alter table public.send_logs enable row level security;

drop policy if exists "public_payment_records_all" on public.payment_records;
drop policy if exists "public_imports_all" on public.imports;
drop policy if exists "public_import_batches_all" on public.import_batches;
drop policy if exists "public_system_settings_all" on public.system_settings;
drop policy if exists "public_send_logs_all" on public.send_logs;

create policy "public_payment_records_all"
on public.payment_records
for all
to anon
using (true)
with check (true);

create policy "public_imports_all"
on public.imports
for all
to anon
using (true)
with check (true);

create policy "public_import_batches_all"
on public.import_batches
for all
to anon
using (true)
with check (true);

create policy "public_system_settings_all"
on public.system_settings
for all
to anon
using (true)
with check (true);

create policy "public_send_logs_all"
on public.send_logs
for all
to anon
using (true)
with check (true);

create table if not exists public.definition_channels (
  id uuid primary key default gen_random_uuid(),
  kanal text not null,
  kp numeric default 0,
  raw_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.definition_dealers (
  id uuid primary key default gen_random_uuid(),
  kanal text,
  bayi text not null,
  bayi_key text,
  bp numeric default 0,
  raw_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.definition_mails (
  id uuid primary key default gen_random_uuid(),
  bayi text not null,
  bayi_key text,
  email text not null,
  raw_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_definition_channels_kanal on public.definition_channels(kanal);
create index if not exists idx_definition_dealers_bayi_key on public.definition_dealers(bayi_key);
create index if not exists idx_definition_mails_bayi_key on public.definition_mails(bayi_key);

alter table public.definition_channels enable row level security;
alter table public.definition_dealers enable row level security;
alter table public.definition_mails enable row level security;

drop policy if exists "public_definition_channels_all" on public.definition_channels;
drop policy if exists "public_definition_dealers_all" on public.definition_dealers;
drop policy if exists "public_definition_mails_all" on public.definition_mails;

create policy "public_definition_channels_all"
on public.definition_channels
for all
to anon
using (true)
with check (true);

create policy "public_definition_dealers_all"
on public.definition_dealers
for all
to anon
using (true)
with check (true);

create policy "public_definition_mails_all"
on public.definition_mails
for all
to anon
using (true)
with check (true);
