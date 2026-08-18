import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Routes, Route, useParams } from 'react-router';
import { ProtectedRoute, PublicOnly, RequireGlobalRole } from './ProtectedRoute';
import { LoginScreen } from '../screens/LoginScreen';
import { ResetPassword } from '../screens/ResetPassword';
import { NotFound } from '../screens/NotFound';
import { SkeletonList } from '../components/Skeleton';

// Ecrans charges A LA DEMANDE (code splitting par route) : ils sortent du bundle initial,
// reduisant fortement le temps de premier chargement. Exports nommes -> on remappe en default.
const Dashboard = lazy(() => import('../screens/member/Dashboard').then((m) => ({ default: m.Dashboard })));
const BaseHome = lazy(() => import('../screens/member/BaseHome').then((m) => ({ default: m.BaseHome })));
const BaseTemplateEditor = lazy(() => import('../screens/member/BaseTemplateEditor').then((m) => ({ default: m.BaseTemplateEditor })));
const MyTemplates = lazy(() => import('../screens/member/MyTemplates').then((m) => ({ default: m.MyTemplates })));
const TemplateFromFile = lazy(() => import('../screens/member/TemplateFromFile').then((m) => ({ default: m.TemplateFromFile })));
const TemplateLibrary = lazy(() => import('../screens/member/TemplateLibrary').then((m) => ({ default: m.TemplateLibrary })));
const NewPatient = lazy(() => import('../screens/member/NewPatient').then((m) => ({ default: m.NewPatient })));
const ImportData = lazy(() => import('../screens/member/ImportData').then((m) => ({ default: m.ImportData })));
const PatientDetail = lazy(() => import('../screens/member/PatientDetail').then((m) => ({ default: m.PatientDetail })));
const EditPatient = lazy(() => import('../screens/member/EditPatient').then((m) => ({ default: m.EditPatient })));
const EditPatientIdentity = lazy(() => import('../screens/member/EditPatientIdentity').then((m) => ({ default: m.EditPatientIdentity })));
const EncounterForm = lazy(() => import('../screens/member/EncounterForm').then((m) => ({ default: m.EncounterForm })));
const EditEncounter = lazy(() => import('../screens/member/EditEncounter').then((m) => ({ default: m.EditEncounter })));
const AddImage = lazy(() => import('../screens/member/AddImage').then((m) => ({ default: m.AddImage })));
const CohortBuilder = lazy(() => import('../screens/member/CohortBuilder').then((m) => ({ default: m.CohortBuilder })));
const ExportPanel = lazy(() => import('../screens/member/ExportPanel').then((m) => ({ default: m.ExportPanel })));
const AccessManagement = lazy(() => import('../screens/member/AccessManagement').then((m) => ({ default: m.AccessManagement })));
const MissionAccounts = lazy(() => import('../screens/member/MissionAccounts').then((m) => ({ default: m.MissionAccounts })));
const ActivityLog = lazy(() => import('../screens/member/ActivityLog').then((m) => ({ default: m.ActivityLog })));
const BaseStats = lazy(() => import('../screens/member/BaseStats').then((m) => ({ default: m.BaseStats })));
const CompletionQueue = lazy(() => import('../screens/member/CompletionQueue').then((m) => ({ default: m.CompletionQueue })));
const BaseProposals = lazy(() => import('../screens/member/BaseProposals').then((m) => ({ default: m.BaseProposals })));
const BaseLayout = lazy(() => import('../screens/member/BaseLayout').then((m) => ({ default: m.BaseLayout })));
const BaseSettings = lazy(() => import('../screens/member/BaseSettings').then((m) => ({ default: m.BaseSettings })));
const GroupList = lazy(() => import('../screens/member/GroupList').then((m) => ({ default: m.GroupList })));
const GroupDetail = lazy(() => import('../screens/member/GroupDetail').then((m) => ({ default: m.GroupDetail })));
const SyncCenter = lazy(() => import('../screens/member/SyncCenter').then((m) => ({ default: m.SyncCenter })));
const Trash = lazy(() => import('../screens/member/Trash').then((m) => ({ default: m.Trash })));
const CurationBoard = lazy(() => import('../screens/member/CurationBoard').then((m) => ({ default: m.CurationBoard })));
const CurationPool = lazy(() => import('../screens/member/CurationPool').then((m) => ({ default: m.CurationPool })));
const CurationTask = lazy(() => import('../screens/member/CurationTask').then((m) => ({ default: m.CurationTask })));
const AcceptInvitation = lazy(() => import('../screens/member/AcceptInvitation').then((m) => ({ default: m.AcceptInvitation })));
const TemplatesAdmin = lazy(() => import('../screens/staff/TemplatesAdmin').then((m) => ({ default: m.TemplatesAdmin })));
const RoleAdmin = lazy(() => import('../screens/staff/RoleAdmin').then((m) => ({ default: m.RoleAdmin })));
const SystemStatus = lazy(() => import('../screens/staff/SystemStatus').then((m) => ({ default: m.SystemStatus })));

// Un COMPTE DE MISSION (role `saisisseur`) n'a acces qu'a la saisie de sa base : ni
// gabarits, ni cohortes, ni statistiques, ni journal, ni curation, ni gestion d'acces.
// Ce filtre de route n'est qu'un confort d'affichage — chacun de ces ecrans est de toute
// facon refuse par la base (docs/spec-comptes-mission.md §4).
const HORS_MISSION = ['medecin', 'curateur'] as const;

// La page intercalaire « saisir moi-meme / confier au staff » a ete retiree du parcours :
// elle n'affichait qu'un seul bouton pour un compte de mission, et une etape de plus pour
// tous les autres. Le formulaire de saisie s'ouvre directement, et confier au staff devient
// une action de son en-tete. Les anciennes URL (liens, favoris) restent valides.
function RedirectToManualPatient() {
  const { id } = useParams();
  return <Navigate to={`/bases/${id}/patients/new/manual`} replace />;
}

function RedirectToManualEncounter() {
  const { id, patientId } = useParams();
  return <Navigate to={`/bases/${id}/patients/${patientId}/encounters/new/manual`} replace />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-6xl p-4 sm:p-6"><SkeletonList rows={5} /></div>}>
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginScreen />
          </PublicOnly>
        }
      />
      {/* Definition d'un nouveau mot de passe : accessible via le lien de l'email de
          recuperation (session temporaire) — pas de garde de role. */}
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/accept-invitation"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <AcceptInvitation />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute area="member">
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/missions"
        element={
          <ProtectedRoute area="member" globalRoles={['medecin']}>
            <MissionAccounts />
          </ProtectedRoute>
        }
      />
      <Route
        path="/templates"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <MyTemplates />
          </ProtectedRoute>
        }
      />
      <Route
        path="/templates/from-file"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <TemplateFromFile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/templates/library"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <TemplateLibrary />
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <GroupList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups/:groupId"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <GroupDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sync"
        element={
          <ProtectedRoute area="member">
            <SyncCenter />
          </ProtectedRoute>
        }
      />
      {/* Corbeille des bases : la creation/possession de bases est reservee au medecin,
          la corbeille ne le concerne donc que lui (meme regle que `canCreateBase`). */}
      <Route
        path="/trash"
        element={
          <ProtectedRoute area="member" globalRoles={['medecin']}>
            <Trash />
          </ProtectedRoute>
        }
      />
      {/* UI-1 : la base est une page a ONGLETS (BaseLayout = fil d'Ariane + onglets + Outlet).
          Les ecrans enfants sont reutilises tels quels. Les parcours "focus" (fiche patient,
          export d'une cohorte) restent hors onglets, en pleine page. */}
      <Route
        path="/bases/:id"
        element={
          <ProtectedRoute area="member">
            <BaseLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<BaseHome />} />
        <Route element={<RequireGlobalRole globalRoles={HORS_MISSION}><Outlet /></RequireGlobalRole>}>
          <Route path="import" element={<ImportData />} />
          <Route path="parametres" element={<BaseSettings />} />
          <Route path="cohorts" element={<CohortBuilder />} />
          <Route path="stats" element={<BaseStats />} />
          <Route path="queue" element={<CompletionQueue />} />
          <Route path="propositions" element={<BaseProposals />} />
          <Route path="activity" element={<ActivityLog />} />
          <Route path="access" element={<AccessManagement />} />
          <Route path="missions" element={<RequireGlobalRole globalRoles={['medecin']}><MissionAccounts /></RequireGlobalRole>} />
          <Route path="template" element={<BaseTemplateEditor />} />
          <Route path="curation" element={<CurationBoard />} />
        </Route>
      </Route>
      <Route
        path="/curation"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <CurationPool />
          </ProtectedRoute>
        }
      />
      <Route
        path="/curation/:taskId"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <CurationTask />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/cohorts/:cohortId/export"
        element={
          <ProtectedRoute area="member" globalRoles={['medecin']}>
            <ExportPanel />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/new"
        element={
          <ProtectedRoute area="member">
            <RedirectToManualPatient />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/new/manual"
        element={
          <ProtectedRoute area="member">
            <NewPatient mode="manual" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/new/submit"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <NewPatient mode="submit" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/:patientId"
        element={
          <ProtectedRoute area="member">
            <PatientDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/:patientId/edit"
        element={
          <ProtectedRoute area="member">
            <EditPatient />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/:patientId/identity/edit"
        element={
          <ProtectedRoute area="member">
            <EditPatientIdentity />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/:patientId/encounters/new"
        element={
          <ProtectedRoute area="member">
            <RedirectToManualEncounter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/:patientId/encounters/new/manual"
        element={
          <ProtectedRoute area="member">
            <EncounterForm />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/:patientId/encounters/:encounterId/edit"
        element={
          <ProtectedRoute area="member">
            <EditEncounter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/:patientId/images/new"
        element={
          <ProtectedRoute area="member" globalRoles={HORS_MISSION}>
            <AddImage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute area="admin">
            <TemplatesAdmin />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/roles"
        element={
          <ProtectedRoute area="admin">
            <RoleAdmin />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/system-status"
        element={
          <ProtectedRoute area="admin">
            <SystemStatus />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
