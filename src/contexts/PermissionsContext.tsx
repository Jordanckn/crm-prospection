import { createContext, ReactNode, useContext } from 'react';
import type { Profile, UserRole } from '../types/database';

type Permissions = {
  role: UserRole;
  isAdmin: boolean;
  canAdd: boolean;
  canModify: boolean;
  canDelete: boolean;
};

const defaultPermissions: Permissions = {
  role: 'contributor',
  isAdmin: false,
  canAdd: true,
  canModify: false,
  canDelete: false,
};

const PermissionsContext = createContext<Permissions>(defaultPermissions);

export function PermissionsProvider({ profile, children }: { profile: Profile | null; children: ReactNode }) {
  const role = profile?.role || 'contributor';
  const isAdmin = role === 'admin';
  return (
    <PermissionsContext.Provider value={{
      role,
      isAdmin,
      canAdd: Boolean(profile?.active),
      canModify: isAdmin || role === 'editor',
      canDelete: isAdmin,
    }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export const usePermissions = () => useContext(PermissionsContext);

export const roleLabel = (role: UserRole) => ({
  admin: 'Administrateur',
  editor: 'Lecture, ajout et modification',
  contributor: 'Lecture et ajout',
}[role]);

