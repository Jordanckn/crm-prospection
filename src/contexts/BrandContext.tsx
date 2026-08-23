import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Brand, Profile } from '../types/database';

const WEBFITYOU: Brand = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'webfityou',
  name: 'WebFitYou',
  logo_url: 'https://ptzpnswtgevfxfeosjfj.supabase.co/storage/v1/object/public/Images/Webfityou-logo-seo-siteweb-ia-complet.png',
  accent_color: '#2563eb',
  email_provider: 'gmail',
  from_name: 'WebFitYou',
  from_email: 'contact@webfityou.com',
  reply_to: 'contact@webfityou.com',
  unsubscribe_email: 'contact@webfityou.com',
};

type BrandContextValue = {
  brand: Brand;
  brands: Brand[];
  switching: boolean;
  switchBrand: (code: string) => Promise<void>;
};

const BrandContext = createContext<BrandContextValue>({
  brand: WEBFITYOU,
  brands: [WEBFITYOU],
  switching: false,
  switchBrand: async () => undefined,
});

export function BrandProvider({ profile, children }: { profile: Profile | null; children: ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([WEBFITYOU]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!profile || import.meta.env.VITE_MULTI_USER_ENABLED !== 'true') return;
    supabase.from('brands').select('id, code, name, logo_url, accent_color, email_provider, from_name, from_email, reply_to, unsubscribe_email')
      .order('name')
      .then(({ data, error }) => {
        if (!error && data?.length) setBrands(data as Brand[]);
      });
  }, [profile]);

  const brand = useMemo(
    () => brands.find(item => item.id === profile?.active_brand_id) || brands[0] || WEBFITYOU,
    [brands, profile?.active_brand_id],
  );

  const switchBrand = async (code: string) => {
    if (code === brand.code || switching) return;
    setSwitching(true);
    const { error } = await supabase.rpc('switch_active_brand', { p_brand_code: code });
    if (error) {
      setSwitching(false);
      throw error;
    }
    // Recharge toutes les vues afin qu'aucun etat de l'espace precedent ne subsiste.
    window.location.reload();
  };

  return (
    <BrandContext.Provider value={{ brand, brands, switching, switchBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export const useBrand = () => useContext(BrandContext);
