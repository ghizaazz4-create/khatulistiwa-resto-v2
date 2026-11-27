-- 005_random_transaction_id.sql
-- ID pesanan acak: YYMMDD-XXXX (4 karakter acak huruf besar + angka),
-- menggantikan nomor urut 001/002/... supaya id tidak bisa ditebak orang
-- dari tanggal + urutan. Alfabet tanpa karakter yang membingungkan
-- (tanpa 0/O, 1/I, L): 32 karakter -> 32^4 kombinasi per hari.
-- Advisory lock dipertahankan; id dicek ke tabel transactions dan
-- diregenerasi bila sudah ada. ID lama yang sudah ada tidak diubah.
-- Definisi yang sama juga ada di 001_init.sql untuk project baru.
create or replace function public.next_transaction_id()
returns text language plpgsql as $$
declare
  prefix text := to_char(now(), 'YYMMDD');
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  suffix text;
  candidate text;
  tries int := 0;
begin
  perform pg_advisory_xact_lock(727271);
  loop
    suffix := '';
    for i in 1..4 loop
      suffix := suffix || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    end loop;
    candidate := prefix || '-' || suffix;
    exit when not exists (select 1 from public.transactions where id = candidate);
    tries := tries + 1;
    if tries > 50 then
      raise exception 'could not generate a unique transaction id';
    end if;
  end loop;
  return candidate;
end;
$$;
