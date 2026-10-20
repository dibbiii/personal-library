-- Segnalibro
-- Migration 218: due nuovi tag tematici, dopo i 18 canonici della 203.
-- `sort_order` non è unico: 19 e 20 si appendono senza toccare l'ordine esistente.

begin;

insert into public.tags (slug, label_it, sort_order, is_active)
values
  ('spicy',                 'Spicy',                 19, true),
  ('thriller-psicologico',  'Thriller psicologico',  20, true)
on conflict (slug) do update set
  label_it = excluded.label_it,
  sort_order = excluded.sort_order,
  is_active = true;

commit;
