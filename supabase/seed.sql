-- Local development seed. Applied by `supabase db reset`.
-- Only registers the first known provider/source — no fabricated pricing.

insert into providers (slug, name, homepage_url)
values ('openai', 'OpenAI', 'https://openai.com')
on conflict (slug) do update
  set name = excluded.name,
      homepage_url = excluded.homepage_url;

insert into sources (provider_id, kind, collector_id, source_url, label)
select p.id,
       'pricing'::source_kind,
       'c_msx3bqlyjtv2qustx',
       'https://developers.openai.com/api/docs/pricing',
       'OpenAI API pricing'
from providers p
where p.slug = 'openai'
on conflict (provider_id, kind, source_url) do update
  set collector_id = excluded.collector_id,
      label = excluded.label;
