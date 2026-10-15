-- Persistent, holder-gated challenge invitations.
-- Apply this migration to the project's Supabase SQL Editor before enabling invite APIs.
create extension if not exists pgcrypto;

create table if not exists public.chog_challenge_invites (
  id uuid primary key default gen_random_uuid(),
  challenger_discord_id text not null,
  challenger_username text not null,
  challenger_wallet text not null,
  challenger_token_id text not null,
  opponent_discord_id text not null,
  opponent_username text,
  opponent_wallet text,
  opponent_token_id text,
  condition_text text not null check (char_length(condition_text) between 5 and 500),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  challenger_terms_accepted boolean not null default true,
  challenger_terms_accepted_at timestamptz not null default now(),
  opponent_terms_accepted boolean not null default false,
  opponent_terms_accepted_at timestamptz,
  challenger_ready boolean not null default false,
  opponent_ready boolean not null default false,
  status text not null default 'PENDING_ACCEPTANCE'
    check (status in (
      'PENDING_ACCEPTANCE',
      'TERMS_ACCEPTED',
      'READY',
      'IN_BATTLE',
      'RESULT_PENDING',
      'SETTLED',
      'CONDITION_PENDING',
      'CONDITION_FULFILLED',
      'DECLINED',
      'CANCELLED',
      'EXPIRED',
      'DISPUTED',
      'ABANDONED'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  constraint invite_players_differ check (challenger_discord_id <> opponent_discord_id),
  constraint opponent_acceptance_consistent check (
    opponent_terms_accepted = (opponent_terms_accepted_at is not null)
  )
);

create index if not exists chog_invites_incoming_idx
  on public.chog_challenge_invites (opponent_discord_id, created_at desc);
create index if not exists chog_invites_outgoing_idx
  on public.chog_challenge_invites (challenger_discord_id, created_at desc);
create index if not exists chog_invites_status_expiry_idx
  on public.chog_challenge_invites (status, expires_at);

alter table public.chog_challenge_invites enable row level security;
alter table public.chog_challenge_invites force row level security;

-- The browser must never query this table directly. Server routes use the service-role key
-- and perform Discord-session/participant checks before every read and state transition.
revoke all on public.chog_challenge_invites from anon, authenticated;
grant all on public.chog_challenge_invites to service_role;

create or replace function public.chog_set_invite_ready(p_invite_id uuid, p_discord_id text)
returns setof public.chog_challenge_invites
language sql
security definer
set search_path = public
as $$
  update public.chog_challenge_invites as invite
  set
    challenger_ready = invite.challenger_ready or invite.challenger_discord_id = p_discord_id,
    opponent_ready = invite.opponent_ready or invite.opponent_discord_id = p_discord_id,
    status = case
      when (invite.challenger_ready or invite.challenger_discord_id = p_discord_id)
       and (invite.opponent_ready or invite.opponent_discord_id = p_discord_id)
        then 'READY'
      else invite.status
    end,
    updated_at = now()
  where invite.id = p_invite_id
    and invite.status in ('TERMS_ACCEPTED', 'READY')
    and p_discord_id in (invite.challenger_discord_id, invite.opponent_discord_id)
  returning invite.*;
$$;

revoke all on function public.chog_set_invite_ready(uuid, text) from public, anon, authenticated;
grant execute on function public.chog_set_invite_ready(uuid, text) to service_role;
