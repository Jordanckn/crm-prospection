WITH template_mappings(source_title, new_title) AS (
  VALUES
    ('J1 - Jordan Chekroun - WebFitYou', 'J+7 - Jordan Chekroun - WebFitYou'),
    ('J1 - Julien Ribardière - WebFitYou', 'J+7 - Julien Ribardière - WebFitYou'),
    ('J1 - Yoann Hadjadj - WebFitYou', 'J+7 - Yoann Hadjadj - WebFitYou')
)
INSERT INTO public.templates (titre, objet, type, contenu, variables)
SELECT
  mapping.new_title,
  'Des clients vous cherchent !',
  'Email',
  $html$<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Des clients vous cherchent !</title>
</head>
<body style="margin:0; padding:0; background:#ffffff; font-family:Arial,Helvetica,sans-serif; color:#172033;">
  <div style="max-width:620px; padding:24px 20px; font-size:15px; line-height:1.6;">
    <p style="margin:0 0 16px;">Bonjour,</p>

    <p style="margin:0 0 16px;">
      Saviez-vous que
      <a href="https://www.lemonde.fr/pixels/article/2026/02/09/l-ia-generative-a-connu-une-adoption-fulgurante-selon-le-barometre-du-numerique-2026_6665972_4408996.html"
         target="_blank"
         style="color:#172033; font-weight:700; text-decoration:underline;">
        48 % des Français
      </a>,
      soit près d’<strong>1 Français sur 2</strong>, utilisent désormais l’intelligence artificielle générative ?
    </p>

    <p style="margin:0 0 16px;">
      L’IA fait aujourd’hui partie des usages quotidiens : pour travailler, comparer, se renseigner, trouver un professionnel ou choisir un service.
    </p>

    <p style="margin:0 0 16px;">
      Chez
      <a href="https://webfityou.com/" target="_blank" style="color:#172033; font-weight:700; text-decoration:none;">
        WebFitYou
      </a>,
      nous aidons les entreprises à être visibles à la fois sur <strong>Google</strong> et sur les moteurs d’IA comme ChatGPT grâce au <strong>GEO – Generative Engine Optimization</strong>.
    </p>

    <p style="margin:0 0 16px;">
      L’objectif est simple : <strong>être visible là où vos clients effectuent déjà leurs recherches.</strong>
    </p>

    <p style="margin:0 0 22px;">
      De plus en plus d’entreprises adaptent leur visibilité à ces nouveaux usages. Pourquoi pas la vôtre ?
    </p>

    <p style="margin:0 0 22px;">
      Je suis à votre disposition pour vous expliquer gratuitement ce que nous pourrions mettre en place.
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
