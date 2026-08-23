WITH template_mappings(source_title, new_title) AS (
  VALUES
    ('J1 - Jordan Chekroun - WebFitYou', 'J+30 - Jordan Chekroun - WebFitYou'),
    ('J1 - Julien Ribardière - WebFitYou', 'J+30 - Julien Ribardière - WebFitYou'),
    ('J1 - Yoann Hadjadj - WebFitYou', 'J+30 - Yoann Hadjadj - WebFitYou')
)
INSERT INTO public.templates (titre, objet, type, contenu, variables)
SELECT
  mapping.new_title,
  'Nos résultats parlent pour nous',
  'Email',
  $html$<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nos résultats parlent pour nous</title>
</head>
<body style="margin:0; padding:0; background:#ffffff; font-family:Arial,Helvetica,sans-serif; color:#172033;">
  <div style="max-width:620px; padding:24px 20px; font-size:15px; line-height:1.6;">
    <p style="margin:0 0 16px;">Bonjour,</p>

    <p style="margin:0 0 16px;">
      Les habitudes de recherche évoluent vite : Google, ChatGPT, moteurs d’IA, campagnes Ads…
    </p>

    <p style="margin:0 0 16px;">
      Chez <strong>WebFitYou</strong>, notre différence repose aussi sur l’expertise de notre fondateur, qui travaille sur ces sujets depuis plusieurs années et a consacré une <strong>thèse complète à ces nouvelles méthodes de référencement et d’acquisition</strong>, bien avant leur démocratisation.
    </p>

    <p style="margin:0 0 16px;">
      Cette méthodologie n’est pas restée théorique : elle a depuis été <strong>appliquée et éprouvée sur des centaines de clients</strong>, avec des progressions de visibilité particulièrement fortes, pouvant mener certains projets jusqu’aux <strong>premières positions en quelques mois</strong>.
    </p>

    <p style="margin:0 0 16px;">
      SEO, GEO, Ads, IA : nous appliquons une méthode déjà testée sur le terrain.
    </p>

    <p style="margin:0 0 16px;">Vous ne nous connaissez pas encore ? Aucun problème.</p>

    <p style="margin:0 0 16px;">
      <strong>Ne nous croyez pas sur parole : regardez nos résultats et ceux de nos clients.</strong>
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
