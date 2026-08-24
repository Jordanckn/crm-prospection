import { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Interactions from './pages/Interactions';
import Taches from './pages/Taches';
import Agenda from './pages/Agenda';
import Templates from './pages/Templates';
import Parametres from './pages/Parametres';
import Rapport from './pages/Rapport';
import Pointage from './pages/Pointage';
import ProgrammationAppels from './pages/ProgrammationAppels';
import Administration from './pages/Administration';
import { supabase } from './lib/supabase';
import type { Contact, Profile } from './types/database';
import { PermissionsProvider } from './contexts/PermissionsContext';
import { BrandProvider } from './contexts/BrandContext';

type SessionUser = {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string };
};

const legacyProfile = (user: SessionUser): Profile => {
  const now = new Date().toISOString();
  const email = user.email || '';
  return {
    id: user.id,
    email,
    full_name: user.user_metadata?.full_name || email.split('@')[0] || 'Utilisateur',
    role: email.toLowerCase() === 'contact@webfityou.com' ? 'admin' : 'contributor',
    active: true,
    manager_id: null,
    active_brand_id: '11111111-1111-4111-8111-111111111111',
    created_at: now,
    updated_at: now,
  };
};

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [editContactTarget, setEditContactTarget] = useState<Contact | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let mounted = true;
    const applySession = async (user?: SessionUser) => {
      if (!user) {
        if (mounted) { setProfile(null); setIsAuthenticated(false); setIsLoading(false); }
        return;
      }

      // Tant que la migration distante n'est pas déployée, ne pas interroger une
      // table `profiles` inexistante (ce qui produirait un 404 dans le navigateur).
      if (import.meta.env.VITE_MULTI_USER_ENABLED !== 'true') {
        if (mounted) {
          setProfile(legacyProfile(user));
          setIsAuthenticated(true);
          setIsLoading(false);
        }
        return;
      }

      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!mounted) return;

      // Compatibilité avec la base historique : l'authentification reste utilisable
      // avant le déploiement de la migration multi-utilisateur qui crée `profiles`.
      if (error?.code === 'PGRST205' || error?.code === '42P01') {
        setProfile(legacyProfile(user));
        setIsAuthenticated(true);
        setIsLoading(false);
        return;
      }

      if (!data?.active) {
        await supabase.auth.signOut();
        setProfile(null);
        setIsAuthenticated(false);
      } else {
        setProfile(data);
        setIsAuthenticated(true);
      }
      setIsLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => applySession(data.session?.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const navigateToContact = (id: string) => {
    setSelectedContactId(id);
    setCurrentPage('contact-detail');
  };

  const handleEditContact = (contact: Contact) => {
    setEditContactTarget(contact);
    setCurrentPage('contacts');
  };

  const handleNavigate = (page: string) => {
    setCurrentPage(page);
    if (page !== 'contact-detail') setSelectedContactId(null);
    setEditContactTarget(null);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'contacts':
        return (
          <Contacts
            onOpenContact={navigateToContact}
            editTarget={editContactTarget}
            onEditTargetHandled={() => setEditContactTarget(null)}
          />
        );
      case 'contact-detail':
        return selectedContactId ? (
          <ContactDetail
            contactId={selectedContactId}
            onBack={() => { setCurrentPage('contacts'); setSelectedContactId(null); }}
            onEdit={handleEditContact}
          />
        ) : null;
      case 'interactions':
        return <Interactions onOpenContact={navigateToContact} />;
      case 'taches':
        return <Taches />;
      case 'agenda':
        return <Agenda />;
      case 'templates':
        return <Templates />;
      case 'parametres':
        return <Parametres />;
      case 'rapport':
        return <Rapport />;
      case 'pointage':
        return <Pointage />;
      case 'programmation-appels':
        return <ProgrammationAppels onOpenContact={navigateToContact} />;
      case 'administration':
        return profile?.role === 'admin' ? <Administration onOpenContact={navigateToContact} /> : <Dashboard />;
      default:
        return <Dashboard />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <PermissionsProvider profile={profile}>
      <BrandProvider profile={profile}>
        <Layout currentPage={currentPage} onNavigate={handleNavigate} profile={profile}>
          {renderPage()}
        </Layout>
      </BrandProvider>
    </PermissionsProvider>
  );
}

export default App;
