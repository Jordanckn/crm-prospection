WITH template_mappings(source_title, new_title) AS (
  VALUES
    ('J1 - Jordan Chekroun - WebFitYou', 'J+15 - Jordan Chekroun - WebFitYou'),
    ('J1 - Julien Ribardière - WebFitYou', 'J+15 - Julien Ribardière - WebFitYou'),
    ('J1 - Yoann Hadjadj - WebFitYou', 'J+15 - Yoann Hadjadj - WebFitYou')
)
INSERT INTO public.templates (titre, objet, type, contenu, variables)
SELECT
  mapping.new_title,
  'Vos concurrents s’adaptent déjà pourquoi pas vous ?',
  'Email',
  $html$<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vos concurrents s’adaptent déjà pourquoi pas vous ?</title>
</head>
<body style="margin:0; padding:0; background:#ffffff; font-family:Arial,Helvetica,sans-serif; color:#172033;">
  <div style="max-width:620px; padding:24px 20px; font-size:15px; line-height:1.6;">
    <p style="margin:0 0 16px;">Bonjour,</p>

    <p style="margin:0 0 16px;">
      Les habitudes de recherche évoluent vite : Google, ChatGPT, moteurs d’IA, campagnes Ads…
    </p>

    <p style="margin:0 0 16px;">
      Les entreprises qui adaptent leur visibilité maintenant prennent naturellement une longueur d’avance sur celles qui attendent.
    </p>

    <p style="margin:0 0 16px;">
      Chez <strong>WebFitYou</strong>, nous aidons les professionnels à se positionner sur ces nouveaux leviers : site internet, SEO, GEO, Ads et automatisations IA.
    </p>

    <p style="margin:0 0 16px;">
      L’objectif est simple : <strong>être visible avant que vos concurrents ne prennent toute la place.</strong>
    </p>

    <p style="margin:0 0 22px;">
      Je peux vous montrer gratuitement ce que nous mettrions en place dans votre cas.
    </p>

    <p style="margin:0 0 16px;">Bien cordialement,</p>

    $html$ || substring(source.contenu FROM position('<table role="presentation"' IN source.contenu)),
  source.variables
FROM template_mappings AS mapping
JOIN public.templates AS source ON source.titre = mapping.source_title
WHERE position('<table role="presentation"' IN source.contenu) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.templates AS existing
    WHERE existing.titre = mapping.new_title
  );
