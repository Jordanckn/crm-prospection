import { LayoutDashboard, Users, MessageSquare, CheckSquare, Settings, FileText, Phone, LogOut, Calendar, BarChart2, Clock, PhoneCall, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import ScriptModal from './ScriptModal';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';
import type { LucideIcon } from 'lucide-react';
import { useBrand } from '../contexts/BrandContext';

type MenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  group?: string;
};

const menuItems: MenuItem[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, group: 'principal' },
  { id: 'contacts', label: 'Contacts', icon: Users, group: 'principal' },
  { id: 'interactions', label: 'Interactions', icon: MessageSquare, group: 'principal' },
  { id: 'taches', label: 'Tâches', icon: CheckSquare, group: 'principal' },
  { id: 'agenda', label: 'Agenda', icon: Calendar, group: 'principal' },
  { id: 'programmation-appels', label: 'Programmation appels', icon: PhoneCall, group: 'principal' },
  { id: 'pointage', label: 'Pointage', icon: Clock, group: 'analyse' },
  { id: 'rapport', label: 'Rapports & KPI', icon: BarChart2, group: 'analyse' },
  { id: 'templates', label: 'Templates', icon: FileText, group: 'outils' },
  { id: 'parametres', label: 'Paramètres', icon: Settings, group: 'outils' },
];

const groups = [
  { key: 'principal', label: 'Principal' },
  { key: 'analyse', label: 'Analyse' },
  { key: 'outils', label: 'Outils' },
];

type SidebarProps = {
  currentPage: string;
  onNavigate: (page: string) => void;
  profile: Profile | null;
};

export default function Sidebar({ currentPage, onNavigate, profile }: SidebarProps) {
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [brandError, setBrandError] = useState('');
  const { brand, brands, switching, switchBrand } = useBrand();

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleBrandChange = async (code: string) => {
    setBrandError('');
    try {
      await switchBrand(code);
    } catch (error) {
      setBrandError(error instanceof Error ? error.message : "Impossible de changer d'espace.");
    }
  };

  return (
    <>
      <div className="w-64 bg-slate-950 text-white h-screen fixed left-0 top-0 flex flex-col shadow-xl">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <img
              src={brand.logo_url}
              alt={`${brand.name} Logo`}
              className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              {brands.length > 1 ? (
                <select
                  aria-label="Espace de marque"
                  value={brand.code}
                  disabled={switching}
                  onChange={event => void handleBrandChange(event.target.value)}
                  className="w-full cursor-pointer border-0 bg-transparent p-0 text-base font-bold leading-tight text-white outline-none disabled:opacity-60"
                >
                  {brands.map(item => <option key={item.id} value={item.code} className="bg-slate-950">{item.name}</option>)}
                </select>
              ) : (
                <h1 className="text-base font-bold text-white leading-tight">{brand.name}</h1>
              )}
              <p className="text-slate-400 text-xs mt-0.5">{switching ? 'Changement…' : 'Connect CRM'}</p>
              {brandError && <p className="mt-1 text-[10px] font-semibold text-red-400">{brandError}</p>}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {profile?.role === 'admin' && (
            <div>
              <p className="px-3 mb-1.5 text-[10px] font-bold text-violet-400 uppercase tracking-widest">Management</p>
              <button
                onClick={() => onNavigate('administration')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-semibold ${
                  currentPage === 'administration'
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-900/50'
                    : 'text-violet-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <ShieldCheck style={{ width: 18, height: 18 }} />
                Administration
              </button>
            </div>
          )}
          {groups.map(group => {
            const items = menuItems.filter(m => m.group === group.key);
            return (
              <div key={group.key}>
                <p className="px-3 mb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{group.label}</p>
                <ul className="space-y-0.5">
                  {items.map(item => {
                    const Icon = item.icon;
                    const isActive = currentPage === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          onClick={() => onNavigate(item.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-medium ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                              : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <Icon className={`w-4.5 h-4.5 flex-shrink-0 ${isActive ? 'text-white' : ''}`} style={{ width: 18, height: 18 }} />
                          <span>{item.label}</span>
                          {item.id === 'rapport' && (
                            <span className="ml-auto text-[9px] bg-blue-500 text-white px-1.5 py-0.5 rounded-full font-bold">NEW</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {/* Script call */}
          <div className="pt-1">
            <button
              onClick={() => setShowScriptModal(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all text-sm font-semibold shadow-md shadow-emerald-900/40"
            >
              <Phone style={{ width: 18, height: 18 }} className="flex-shrink-0" />
              <span>Script d'appel</span>
            </button>
          </div>
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-slate-800 space-y-2">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:bg-red-900/40 hover:text-red-400 transition-all text-sm font-medium"
          >
            <LogOut style={{ width: 18, height: 18 }} className="flex-shrink-0" />
            <span>Déconnexion</span>
          </button>
          <p className="text-[10px] text-slate-600 px-3">v1.1.0</p>
        </div>
      </div>

      <ScriptModal isOpen={showScriptModal} onClose={() => setShowScriptModal(false)} />
    </>
  );
}
