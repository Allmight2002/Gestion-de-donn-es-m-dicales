import { createContext, useContext, type ReactNode } from 'react';
import { templateRepository, type TemplateRepository } from './templates';
import { baseRepository, type BaseRepository } from './bases';
import { patientRepository, type PatientRepository } from './patients';
import { attachmentRepository, type AttachmentRepository } from './attachments';
import { cohortRepository, type CohortRepository } from './cohorts';
import { exportRepository, type ExportRepository } from './exports';
import { accessRepository, type AccessRepository } from './access';
import { curationRepository, type CurationRepository } from './curation';
import { adminRepository, type AdminRepository } from './admin';
import { auditRepository, type AuditRepository } from './audit';

interface Repositories {
  templates: TemplateRepository;
  bases: BaseRepository;
  patients: PatientRepository;
  attachments: AttachmentRepository;
  cohorts: CohortRepository;
  exports: ExportRepository;
  access: AccessRepository;
  curation: CurationRepository;
  admin: AdminRepository;
  audit: AuditRepository;
}

const RepositoryContext = createContext<Repositories>({
  templates: templateRepository,
  bases: baseRepository,
  patients: patientRepository,
  attachments: attachmentRepository,
  cohorts: cohortRepository,
  exports: exportRepository,
  access: accessRepository,
  curation: curationRepository,
  admin: adminRepository,
  audit: auditRepository,
});

export function RepositoryProvider({
  children,
  templates = templateRepository,
  bases = baseRepository,
  patients = patientRepository,
  attachments = attachmentRepository,
  cohorts = cohortRepository,
  exports = exportRepository,
  access = accessRepository,
  curation = curationRepository,
  admin = adminRepository,
  audit = auditRepository,
}: {
  children: ReactNode;
  templates?: TemplateRepository;
  bases?: BaseRepository;
  patients?: PatientRepository;
  attachments?: AttachmentRepository;
  cohorts?: CohortRepository;
  exports?: ExportRepository;
  access?: AccessRepository;
  curation?: CurationRepository;
  admin?: AdminRepository;
  audit?: AuditRepository;
}) {
  return (
    <RepositoryContext.Provider value={{ templates, bases, patients, attachments, cohorts, exports, access, curation, admin, audit }}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useTemplateRepository(): TemplateRepository {
  return useContext(RepositoryContext).templates;
}

export function useBaseRepository(): BaseRepository {
  return useContext(RepositoryContext).bases;
}

export function usePatientRepository(): PatientRepository {
  return useContext(RepositoryContext).patients;
}

export function useAttachmentRepository(): AttachmentRepository {
  return useContext(RepositoryContext).attachments;
}

export function useCohortRepository(): CohortRepository {
  return useContext(RepositoryContext).cohorts;
}

export function useExportRepository(): ExportRepository {
  return useContext(RepositoryContext).exports;
}

export function useAccessRepository(): AccessRepository {
  return useContext(RepositoryContext).access;
}

export function useCurationRepository(): CurationRepository {
  return useContext(RepositoryContext).curation;
}

export function useAdminRepository(): AdminRepository {
  return useContext(RepositoryContext).admin;
}

export function useAuditRepository(): AuditRepository {
  return useContext(RepositoryContext).audit;
}
