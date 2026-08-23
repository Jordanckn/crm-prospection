import { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Search, X, Building2, Phone, Mail, ChevronRight, Briefcase, RotateCcw } from 'lucide-react';
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../lib/supabase';
import type { Contact } from '../types/database';

const SECTEUR_COLORS: Record<string, string> = {
  'Agriculture': '#16a34a',
  'Alimentation & Restauration': '#f97316',
  'Artisanat': '#a16207',
  'Automobile': '#6b7280',
  'Banque & Finance': '#0ea5e9',
  'BTP & Construction': '#b45309',
  'Commerce & Distribution': '#e11d48',
  'Conseil & Services': '#0284c7',
  'Droit & Juridique': '#7c3aed',
  'Éducation & Formation': '#2563eb',
  'Énergie': '#ca8a04',
  'High-Tech & Informatique': '#0891b2',
  'Hôtellerie & Tourisme': '#db2777',
  'Immobilier': '#92400e',
  'Industrie & Manufacturing': '#374151',
  'Logistique & Transport': '#4b5563',
  'Médias & Communication': '#d97706',
  'Santé & Pharmacie': '#dc2626',
  'Télécommunications': '#0891b2',
  'Textile & Mode': '#be185d',
  'Autre': '#64748b',
};
const DEFAULT_COLOR = '#3b82f6';
const DEFAULT_CENTER: [number, number] = [46.603354, 1.888334];
const DEFAULT_ZOOM = 6;

function getSecteurColor(secteur: string): string {
  return SECTEUR_COLORS[secteur] || DEFAULT_COLOR;
}

async function geocodeAddress(contact: Contact): Promise<{ latitude: number; longitude: number } | null> {
  const parts = [contact.adresse, contact.code_postal, contact.ville, contact.pays].filter(Boolean).join(', ');
  if (!parts.trim()) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(parts)}&format=json&limit=1`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
    const data = await resp.json();
    if (data && data[0]) {
      return { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) };
    }
  } catch {}
  return null;
}

type Props = {
  contacts: Contact[];
  onContactsUpdated: () => void;
};

function MapViewport({ contacts }: { contacts: Contact[] }) {
  const map = useMap();
  const viewportKey = contacts
    .map(contact => `${contact.id}:${contact.latitude}:${contact.longitude}`)
    .join('|');

  useEffect(() => {
    const positions = contacts
      .filter(contact => contact.latitude != null && contact.longitude != null)
      .map(contact => [contact.latitude!, contact.longitude!] as [number, number]);

    if (positions.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    } else if (positions.length === 1) {
      map.setView(positions[0], 13);
    } else {
      map.fitBounds(positions, { padding: [40, 40], maxZoom: 13 });
    }
  }, [map, viewportKey]);

  return null;
}

export default function ContactMap({ contacts, onContactsUpdated }: Props) {
  const mapRef = useRef<LeafletMap | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterSecteur, setFilterSecteur] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState(0);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [, forceRender] = useState(0);

  const contactsWithCoords = contacts.filter(c => c.latitude != null && c.longitude != null);
  const contactsWithoutCoords = contacts.filter(
    c => c.latitude == null && c.longitude == null && (c.adresse || c.ville)
  );
  const secteurs = [...new Set(contacts.map(c => c.secteur_activite).filter(Boolean))].sort();

  const filteredContacts = contactsWithCoords.filter(c => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term || (
      c.prenom.toLowerCase().includes(term) ||
      c.nom.toLowerCase().includes(term) ||
      (c.ville || '').toLowerCase().includes(term) ||
      (c.entreprise || '').toLowerCase().includes(term) ||
      (c.secteur_activite || '').toLowerCase().includes(term)
    );
    const matchesSecteur = !filterSecteur || c.secteur_activite === filterSecteur;
    return matchesSearch && matchesSecteur;
  });

  const flyTo = useCallback((contact: Contact) => {
    if (contact.latitude == null || contact.longitude == null) return;
    mapRef.current?.flyTo([contact.latitude, contact.longitude], 14, { duration: 0.7 });
    setSelectedContact(contact);
  }, []);

  const resetView = () => {
    if (contactsWithCoords.length === 0) {
      mapRef.current?.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    } else if (contactsWithCoords.length === 1) {
      mapRef.current?.setView([contactsWithCoords[0].latitude!, contactsWithCoords[0].longitude!], 13);
    } else {
      mapRef.current?.fitBounds(
        contactsWithCoords.map(contact => [contact.latitude!, contact.longitude!] as [number, number]),
        { padding: [40, 40], maxZoom: 13 },
      );
    }
    setSelectedContact(null);
  };

  const geocodeAll = async () => {
    if (geocoding || contactsWithoutCoords.length === 0) return;
    setGeocoding(true);
    setGeocodingProgress(0);
    for (let i = 0; i < contactsWithoutCoords.length; i++) {
      const contact = contactsWithoutCoords[i];
      const coords = await geocodeAddress(contact);
      if (coords) {
        await supabase.from('contacts').update({ latitude: coords.latitude, longitude: coords.longitude }).eq('id', contact.id);
      }
      setGeocodingProgress(Math.round(((i + 1) / contactsWithoutCoords.length) * 100));
      await new Promise(r => setTimeout(r, 1100));
    }
    setGeocoding(false);
    setGeocodingProgress(0);
    onContactsUpdated();
  };

  const getStatutColor = (statut: string) => {
    switch (statut) {
      case 'Nouveau': return 'bg-blue-100 text-blue-700';
      case 'En cours': return 'bg-amber-100 text-amber-700';
      case 'Converti': return 'bg-emerald-100 text-emerald-700';
      case 'Perdu': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-[760px] md:h-[680px]">
      <div className="flex h-full flex-col md:flex-row">
        {/* Sidebar */}
        <div className="h-72 w-full flex-shrink-0 border-b border-slate-200 flex flex-col bg-white md:h-full md:w-80 md:border-b-0 md:border-r">
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span className="font-semibold text-slate-900 text-sm">
                {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''} sur la carte
              </span>
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Nom, ville, entreprise..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" />
                </button>
              )}
            </div>

            <select
              value={filterSecteur}
              onChange={e => setFilterSecteur(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">Tous les secteurs</option>
              {secteurs.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {(searchTerm || filterSecteur) && (
              <button
                onClick={() => { setSearchTerm(''); setFilterSecteur(''); }}
                className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Effacer les filtres
              </button>
            )}
          </div>

          {contactsWithoutCoords.length > 0 && (
            <div className="mx-3 mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-xs text-amber-800 font-medium mb-2">
                {contactsWithoutCoords.length} contact{contactsWithoutCoords.length > 1 ? 's' : ''} sans coordonnées
              </p>
              <button
                onClick={geocodeAll}
                disabled={geocoding}
                className="w-full py-1.5 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors disabled:opacity-60"
              >
                {geocoding ? `Localisation... ${geocodingProgress}%` : 'Localiser automatiquement'}
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto mt-2">
            {filteredContacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                <MapPin className="w-8 h-8 text-slate-200 mb-2" />
                <p className="text-sm text-slate-400">Aucun contact trouvé</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredContacts.map(contact => {
                  const isSelected = selectedContact?.id === contact.id;
                  const color = getSecteurColor(contact.secteur_activite);
                  return (
                    <li key={contact.id}>
                      <button
                        onClick={() => flyTo(contact)}
                        className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3 ${
                          isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                        }`}
                      >
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
                          style={{ background: color }}
                        >
                          {contact.prenom[0]}{contact.nom[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className={`text-sm font-semibold truncate ${isSelected ? 'text-blue-700' : 'text-slate-900'}`}>
                              {contact.prenom} {contact.nom}
                            </p>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                          </div>
                          {contact.entreprise && (
                            <p className="text-xs text-slate-500 truncate flex items-center gap-1 mt-0.5">
                              <Building2 className="w-3 h-3 flex-shrink-0" />
                              {contact.entreprise}
                            </p>
                          )}
                          {contact.secteur_activite && (
                            <div className="flex items-center gap-1 mt-1">
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                              <span className="text-xs text-slate-400 truncate">{contact.secteur_activite}</span>
                            </div>
                          )}
                          {contact.ville && (
                            <p className="text-xs text-slate-400 truncate mt-0.5">
                              <MapPin className="w-3 h-3 inline mr-0.5" />
                              {[contact.code_postal, contact.ville].filter(Boolean).join(' ')}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {secteurs.length > 0 && (
            <div className="border-t border-slate-100 p-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Secteurs</p>
              <div className="flex flex-wrap gap-1.5">
                {secteurs.filter(s => contactsWithCoords.some(c => c.secteur_activite === s)).map(s => (
                  <button
                    key={s}
                    onClick={() => { setFilterSecteur(filterSecteur === s ? '' : s); forceRender(n => n + 1); }}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                      filterSecteur === s
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'text-slate-600 border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: getSecteurColor(s) }} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 relative min-h-[360px]">
          <MapContainer
            ref={mapRef}
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            scrollWheelZoom
            className="h-full w-full"
            whenReady={() => setMapLoaded(true)}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              subdomains="abcd"
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />
            <MapViewport contacts={filteredContacts} />
            {filteredContacts.map(contact => (
              <CircleMarker
                key={contact.id}
                center={[contact.latitude!, contact.longitude!]}
                radius={10}
                pathOptions={{
                  color: '#ffffff',
                  weight: 2,
                  fillColor: getSecteurColor(contact.secteur_activite),
                  fillOpacity: 1,
                }}
                eventHandlers={{
                  click: () => {
                    setSelectedContact(previous => previous?.id === contact.id ? null : contact);
                    mapRef.current?.panTo([contact.latitude!, contact.longitude!]);
                  },
                }}
              />
            ))}
          </MapContainer>

          {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          <button
            onClick={resetView}
            className="absolute top-3 right-3 w-9 h-9 bg-white rounded-lg shadow-md border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors z-[1000]"
            title="Réinitialiser la vue"
          >
            <RotateCcw className="w-4 h-4 text-slate-700" />
          </button>

          {selectedContact && (
            <div className="absolute bottom-6 left-4 right-4 sm:left-auto sm:right-14 sm:w-72 bg-white rounded-xl shadow-2xl border border-slate-100 p-4 z-[1000]">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                    style={{ background: getSecteurColor(selectedContact.secteur_activite) }}
                  >
                    {selectedContact.prenom[0]}{selectedContact.nom[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{selectedContact.prenom} {selectedContact.nom}</p>
                    {selectedContact.entreprise && (
                      <p className="text-xs text-slate-500">{selectedContact.entreprise}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedContact(null)}
                  className="p-1 hover:bg-slate-100 rounded-md transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              <div className="space-y-1.5">
                {selectedContact.secteur_activite && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Briefcase className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs">{selectedContact.secteur_activite}</span>
                  </div>
                )}
                {(selectedContact.adresse || selectedContact.ville) && (
                  <div className="flex items-start gap-2 text-slate-600">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span className="text-xs leading-relaxed">
                      {[selectedContact.adresse, selectedContact.code_postal, selectedContact.ville].filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
                {selectedContact.telephone && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                    <a href={`tel:${selectedContact.telephone}`} className="text-xs text-blue-600 hover:underline">
                      {selectedContact.telephone}
                    </a>
                  </div>
                )}
                {selectedContact.email && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                    <a href={`mailto:${selectedContact.email}`} className="text-xs text-blue-600 hover:underline truncate">
                      {selectedContact.email}
                    </a>
                  </div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getStatutColor(selectedContact.statut)}`}>
                  {selectedContact.statut}
                </span>
                {(selectedContact.adresse || selectedContact.ville) && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([selectedContact.adresse, selectedContact.code_postal, selectedContact.ville, selectedContact.pays].filter(Boolean).join(', '))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    Ouvrir dans Maps
                    <ChevronRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {filteredContacts.length === 0 && contactsWithCoords.length === 0 && mapLoaded && (
            <div className="absolute inset-0 z-[900] flex flex-col items-center justify-center gap-3 bg-slate-50/80 pointer-events-none">
              <MapPin className="w-12 h-12 text-slate-300" />
              <p className="text-slate-500 font-medium">Aucun contact localisé</p>
              {contactsWithoutCoords.length > 0 && (
                <p className="text-slate-400 text-sm text-center px-8">
                  Utilisez le panneau gauche pour localiser vos contacts
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
