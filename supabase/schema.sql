create extension if not exists pgcrypto;

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists public.attendance_records (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  attended_at timestamptz not null default now(),
  unique (session_id)
);

create table if not exists public.attendance_logs (
  id bigint generated always as identity primary key,
  session_id text,
  name text,
  status text not null check (status in ('success', 'failed')),
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_logs enable row level security;

create or replace function public.mark_attendance_once(
  p_session_id uuid,
  p_name text
)
returns table(
  success boolean,
  message text,
  attended_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attended_at timestamptz := now();
  v_session_id uuid;
  v_session_exists boolean;
begin
  if coalesce(btrim(p_name), '') = '' then
    return query select false, 'Absen belum berhasil', null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from public.attendance_records
    where session_id = p_session_id
  ) then
    return query select false, 'QR ini sudah digunakan untuk absen', null::timestamptz;
    return;
  end if;

  update public.attendance_sessions
  set used_at = v_attended_at
  where id = p_session_id
    and used_at is null
  returning id into v_session_id;

  if not found then
    select exists (
      select 1
      from public.attendance_sessions
      where id = p_session_id
    ) into v_session_exists;

    if v_session_exists then
      return query select false, 'QR ini sudah digunakan untuk absen', null::timestamptz;
    else
      return query select false, 'Absen belum berhasil', null::timestamptz;
    end if;

    return;
  end if;

  insert into public.attendance_records (session_id, name, attended_at)
  values (p_session_id, btrim(p_name), v_attended_at);

  return query select true, 'Absen berhasil', v_attended_at;
end;
$$;
