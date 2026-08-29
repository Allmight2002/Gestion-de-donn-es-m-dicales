import type { BaseListing } from '../data/bases';
import type { PatientListItem } from '../data/patients';

export function canCorrectPatientIdentity(base: BaseListing | null, patient: PatientListItem | null): boolean {
  if (!base || !patient?.identity) return false;
  if (base.role === 'owner') return true;
  if (base.permissions.canViewIdentity && base.permissions.canEditStructuredData) return true;

  const expiresAt = base.expiresAt ? Date.parse(base.expiresAt) : Number.NaN;
  return base.permissions.canViewIdentity
    && base.canCreateStructuredData === true
    && !base.permissions.canEditStructuredData
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now()
    && patient.validationStatus === 'draft'
    && !!base.currentUserId
    && patient.createdBy === base.currentUserId;
}
