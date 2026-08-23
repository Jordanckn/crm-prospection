WITH template_mappings(source_title, new_title) AS (
  VALUES
    ('J1 - Jordan Chekroun - WebFitYou', 'J+2 - Jordan Chekroun - WebFitYou'),
    ('J1 - Julien Ribardière - WebFitYou', 'J+2 - Julien Ribardière - WebFitYou'),
    ('J1 - Yoann Hadjadj - WebFitYou', 'J+2 - Yoann Hadjadj - WebFitYou')
)
INSERT INTO public.templates (titre, objet, type, contenu, variables)
SELECT
  mapping.new_title,
  'Je me permets de revenir vers vous',
  'Email',
  $html$<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Je me permets de revenir vers vous</title>
</head>
<body style="margin:0; padding:0; background:#ffffff; font-family:Arial,Helvetica,sans-serif; color:#172033;">
  <div style="max-width:620px; padding:24px 20px; font-size:15px; line-height:1.6;">
    <p style="margin:0 0 16px;">Bonjour,</p>

    <p style="margin:0 0 16px;">Je me permets de revenir vers vous concernant mon précédent message.</p>

    <p style="margin:0 0 16px;">
      Avec l’arrivée de <strong>ChatGPT Ads en France</strong>, il y a de nouvelles opportunités pour les entreprises locales de gagner en visibilité et de générer davantage de demandes.
    </p>

    <p style="margin:0 0 16px;">
      Si vous souhaitez, je peux simplement vous expliquer en <strong>10 minutes</strong> ce que cela pourrait apporter à votre entreprise.
    </p>

    <p style="margin:0 0 16px;">C’est gratuit et sans engagement.</p>

    <p style="margin:0 0 22px;">Un simple retour à ce mail suffit et je vous rappelle.</p>

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
