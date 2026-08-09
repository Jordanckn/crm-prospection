import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variables Supabase manquantes');
}

// Le schéma évolue via les migrations Supabase. Les types métier restent définis
// dans src/types/database.ts, tandis que le client accepte aussi les tables ajoutées
// par les nouvelles migrations sans les réduire à `never`.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
