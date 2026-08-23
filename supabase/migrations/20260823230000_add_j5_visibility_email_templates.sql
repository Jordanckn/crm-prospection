WITH template_mappings(source_title, new_title) AS (
  VALUES
    ('J1 - Jordan Chekroun - WebFitYou', 'J+5 - Jordan Chekroun - WebFitYou'),
    ('J1 - Julien Ribardière - WebFitYou', 'J+5 - Julien Ribardière - WebFitYou'),
    ('J1 - Yoann Hadjadj - WebFitYou', 'J+5 - Yoann Hadjadj - WebFitYou')
)
INSERT INTO public.templates (titre, objet, type, contenu, variables)
SELECT
  mapping.new_title,
  'Votre visibilité peut aller beaucoup plus loin',
  'Email',
  $html$<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Votre visibilité peut aller beaucoup plus loin</title>
</head>
<body style="margin:0; padding:0; background:#ffffff; font-family:Arial,Helvetica,sans-serif; color:#172033;">
  <div style="max-width:620px; padding:24px 20px; font-size:15px; line-height:1.6;">
    <p style="margin:0 0 16px;">Bonjour,</p>

    <p style="margin:0 0 16px;">Aujourd’hui, un site internet seul ne suffit plus.</p>

    <p style="margin:0 0 16px;">
      Chez <strong>WebFitYou</strong>, nous aidons les entreprises à générer davantage de demandes grâce à leur site, Google, les moteurs d’IA, les campagnes publicitaires et des agents IA capables de répondre aux appels et qualifier les prospects.
    </p>

    <p style="margin:0 0 16px;">
      L’objectif : <strong>plus de visibilité, plus de contacts, moins de temps perdu.</strong>
    </p>

    <p style="margin:0 0 16px;">
      Je peux vous montrer gratuitement ce qui serait le plus pertinent pour votre entreprise.
    </p>

    <p style="margin:0 0 22px;">Si cela vous intéresse, un simple retour à ce mail suffit.</p>

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
