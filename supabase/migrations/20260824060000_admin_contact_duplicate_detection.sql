/* Detection de doublons, strictement reservee aux administrateurs. */

CREATE OR REPLACE FUNCTION public.admin_find_contact_duplicates()
RETURNS TABLE (
  match_type text,
  match_value text,
  contact_ids uuid[],
  contact_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acces reserve aux administrateurs';
  END IF;

  RETURN QUERY
  WITH normalized AS (
    SELECT
      c.id,
      regexp_replace(lower(trim(COALESCE(NULLIF(c.entreprise, ''), concat_ws(' ', c.prenom, c.nom)))), '[^[:alnum:]]+', '', 'g') AS company_key,
      regexp_replace(COALESCE(c.siren_siret, ''), '[^0-9]', '', 'g') AS siren_key,
      CASE
        WHEN length(regexp_replace(COALESCE(c.telephone, ''), '[^0-9]', '', 'g')) >= 9
          THEN right(regexp_replace(COALESCE(c.telephone, ''), '[^0-9]', '', 'g'), 9)
        ELSE ''
      END AS phone_key,
      regexp_replace(
        regexp_replace(lower(trim(COALESCE(c.site_web, ''))), '^https?://(www\.)?', ''),
        '[/#?].*$', ''
      ) AS website_key,
      lower(trim(COALESCE(c.email, ''))) AS email_key
    FROM public.contacts c
    WHERE c.brand_id = public.current_brand_id()
  ), duplicate_groups AS (
    SELECT 'entreprise'::text AS kind, company_key AS value, array_agg(id ORDER BY id) AS ids, count(*) AS total
    FROM normalized WHERE length(company_key) >= 4 GROUP BY company_key HAVING count(*) > 1
    UNION ALL
    SELECT 'siren_siret', siren_key, array_agg(id ORDER BY id), count(*)
    FROM normalized WHERE length(siren_key) >= 9 GROUP BY siren_key HAVING count(*) > 1
    UNION ALL
    SELECT 'telephone', phone_key, array_agg(id ORDER BY id), count(*)
    FROM normalized WHERE phone_key <> '' GROUP BY phone_key HAVING count(*) > 1
    UNION ALL
    SELECT 'site_web', website_key, array_agg(id ORDER BY id), count(*)
    FROM normalized WHERE length(website_key) >= 4 GROUP BY website_key HAVING count(*) > 1
    UNION ALL
    SELECT 'email', email_key, array_agg(id ORDER BY id), count(*)
    FROM normalized WHERE email_key LIKE '%@%' GROUP BY email_key HAVING count(*) > 1
  )
  SELECT kind, value, ids, total
  FROM duplicate_groups
  ORDER BY total DESC, kind, value;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_find_contact_duplicates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_find_contact_duplicates() TO authenticated;
