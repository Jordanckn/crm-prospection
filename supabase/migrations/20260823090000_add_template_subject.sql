/*
  Sépare le nom interne d'un template de l'objet réellement envoyé.
  Les modèles existants conservent leur comportement grâce au préremplissage.
*/

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS objet text NOT NULL DEFAULT '';

UPDATE public.templates
SET objet = titre
WHERE type = 'Email' AND btrim(objet) = '';

