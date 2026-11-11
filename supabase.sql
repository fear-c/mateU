-- MateU: jalankan seluruh isi file ini di Supabase > SQL Editor > New query > Run

create table profiles(
  id uuid primary key references auth.users on delete cascade,
  role text not null default 'customer' check (role in ('customer','psi')),
  nickname text, full_name text, created_at timestamptz default now());

create table professionals(
  id uuid primary key references profiles on delete cascade,
  title text not null default 'Psikolog Klinis' check (title in ('Psikolog Klinis','Psikiater')),
  years int not null default 1,
  price int not null default 150000 check (price between 10000 and 5000000),
  about text not null default '', edu text not null default '',
  verified boolean not null default false,   -- admin ubah jadi true setelah cek STR/SIP
  available boolean not null default true);

create table bookings(
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles,
  pro_id uuid not null references professionals,
  day date not null,
  slot text not null check (slot in ('10.30','15.00','19.00')),
  mode text not null default 'online' check (mode in ('online','offline')),
  price int not null default 0, fee int not null default 0,
  commission_pct int not null default 15,
  status text not null default 'pending' check (status in ('pending','paid','done','cancelled')),
  created_at timestamptz default now());
create unique index on bookings(pro_id,day,slot) where status in ('paid','done');

create table messages(
  id bigint generated always as identity primary key,
  booking_id uuid not null references bookings on delete cascade,
  sender_id uuid not null references profiles,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz default now());

-- akun baru -> otomatis dibuatkan profil (dan data psikolog bila role = psi)
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare r text := case when new.raw_user_meta_data->>'role'='psi' then 'psi' else 'customer' end;
        n text := left(coalesce(nullif(new.raw_user_meta_data->>'name',''),'Teman'),60);
begin
  insert into profiles(id,role,nickname,full_name)
  values(new.id,r,case when r='customer' then n end,case when r='psi' then n end);
  if r='psi' then insert into professionals(id) values(new.id); end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- harga ditetapkan server: tarif psikolog + biaya layanan Rp10.000, komisi 15%
create function set_booking_price() returns trigger language plpgsql security definer set search_path=public as $$
declare p professionals;
begin
  select * into p from professionals where id=new.pro_id and verified and available;
  if not found then raise exception 'Psikolog tidak tersedia'; end if;
  if new.day < current_date then raise exception 'Tanggal sudah lewat'; end if;
  new.price:=p.price; new.fee:=10000; new.commission_pct:=15; new.status:='pending';
  return new;
end $$;
create trigger booking_price before insert on bookings for each row execute function set_booking_price();

create function taken_slots(p uuid, d date) returns text[] language sql security definer set search_path=public as $$
  select coalesce(array_agg(slot),'{}') from bookings where pro_id=p and day=d and status in ('paid','done') $$;

alter table profiles enable row level security;
alter table professionals enable row level security;
alter table bookings enable row level security;
alter table messages enable row level security;

create policy p_sel on profiles for select to authenticated using (
  id=auth.uid()
  or exists(select 1 from professionals p where p.id=profiles.id and p.verified)
  or exists(select 1 from bookings b where (b.customer_id=auth.uid() and b.pro_id=profiles.id) or (b.pro_id=auth.uid() and b.customer_id=profiles.id)));
create policy p_upd on profiles for update to authenticated using (id=auth.uid());
revoke update on profiles from authenticated;
grant update(nickname,full_name) on profiles to authenticated;

create policy pr_sel on professionals for select to authenticated using (verified or id=auth.uid());
create policy pr_upd on professionals for update to authenticated using (id=auth.uid());
revoke update on professionals from authenticated;
grant update(title,years,price,about,edu,available) on professionals to authenticated;

create policy b_sel on bookings for select to authenticated using (customer_id=auth.uid() or pro_id=auth.uid());
create policy b_ins on bookings for insert to authenticated with check (customer_id=auth.uid());
create policy b_upd on bookings for update to authenticated using (pro_id=auth.uid() and status='paid') with check (status='done');
revoke update on bookings from authenticated;
grant update(status) on bookings to authenticated;

create policy m_sel on messages for select to authenticated using (exists(select 1 from bookings b where b.id=messages.booking_id and (b.customer_id=auth.uid() or b.pro_id=auth.uid()) and b.status in ('paid','done')));
create policy m_ins on messages for insert to authenticated with check (sender_id=auth.uid() and exists(select 1 from bookings b where b.id=booking_id and (b.customer_id=auth.uid() or b.pro_id=auth.uid()) and b.status in ('paid','done')));

alter publication supabase_realtime add table messages, bookings;

-- OPSIONAL, mode uji coba tanpa Midtrans: pelanggan bisa "membayar" gratis.
-- Hapus fungsi ini (drop function demo_pay(uuid);) sebelum memakai pembayaran sungguhan.
create function demo_pay(b uuid) returns void language sql security definer set search_path=public as $$
  update bookings set status='paid' where id=b and customer_id=auth.uid() and status='pending' $$;
revoke execute on function demo_pay(uuid) from public, anon;
grant execute on function demo_pay(uuid) to authenticated;
