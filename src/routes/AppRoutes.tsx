import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute, PublicOnly } from './ProtectedRoute';
import { LoginScreen } from '../screens/LoginScreen';
import { ResetPassword } from '../screens/ResetPassword';
import { NotFound } from '../screens/NotFound';

// Ecrans charges A LA DEMANDE (code splitting par route) : ils sortent du bundle initial,
// reduisant fortement le temps de premier chargement. Exports nommes -> on remappe en default.
const Dashboard = lazy(() => import('../screens/member/Dashboard').then((m) => ({ default: m.Dashboard })));
const BaseHome = lazy(() => import('../screens/member/BaseHome').then((m) => ({ default: m.BaseHome })));
const BaseTemplateEditor = lazy(() => import('../screens/member/BaseTemplateEditor').then((m) => ({ default: m.BaseTemplateEditor })));
const MyTemplates = lazy(() => import('../screens/member/MyTemplates').then((m) => ({ default: m.MyTemplates })));
const NewPatient = lazy(() => import('../screens/member/NewPatient').then((m) => ({ default: m.NewPatient })));
const PatientCreateChoice = lazy(() => import('../screens/member/PatientCreateChoice').then((m) => ({ default: m.PatientCreateChoice })));
const ImportData = lazy(() => import('../screens/member/ImportData').then((m) => ({ default: m.ImportData })));
const EncounterCreateChoice = lazy(() => import('../screens/member/EncounterCreateChoice').then((m) => ({ default: m.EncounterCreateChoice })));
const PatientDetail = lazy(() => import('../screens/member/PatientDetail').then((m) => ({ default: m.PatientDetail })));
const EditPatient = lazy(() => import('../screens/member/EditPatient').then((m) => ({ default: m.EditPatient })));
const EncounterForm = lazy(() => import('../screens/member/EncounterForm').then((m) => ({ default: m.EncounterForm })));
const EditEncounter = lazy(() => import('../screens/member/EditEncounter').then((m) => ({ default: m.EditEncounter })));
const AddImage = lazy(() => import('../screens/member/AddImage').then((m) => ({ default: m.AddImage })));
const CohortBuilder = lazy(() => import('../screens/member/CohortBuilder').then((m) => ({ default: m.CohortBuilder })));
const ExportPanel = lazy(() => import('../screens/member/ExportPanel').then((m) => ({ default: m.ExportPanel })));
const AccessManagement = lazy(() => import('../screens/member/AccessManagement').then((m) => ({ default: m.AccessManagement })));
const ActivityLog = lazy(() => import('../screens/member/ActivityLog').then((m) => ({ default: m.ActivityLog })));
const SyncCenter = lazy(() => import('../screens/member/SyncCenter').then((m) => ({ default: m.SyncCenter })));
const CurationBoard = lazy(() => import('../screens/member/CurationBoard').then((m) => ({ default: m.CurationBoard })));
const CurationPool = lazy(() => import('../screens/member/CurationPool').then((m) => ({ default: m.CurationPool })));
const CurationTask = lazy(() => import('../screens/member/CurationTask').then((m) => ({ default: m.CurationTask })));
const AcceptInvitation = lazy(() => import('../screens/member/AcceptInvitation').then((m) => ({ default: m.AcceptInvitation })));
const TemplatesAdmin = lazy(() => import('../screens/staff/TemplatesAdmin').then((m) => ({ default: m.TemplatesAdmin })));
const RoleAdmin = lazy(() => import('../screens/staff/RoleAdmin').then((m) => ({ default: m.RoleAdmin })));

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-400">…</div>}>
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
          <ProtectedRoute area="member">
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
        path="/templates"
        element={
          <ProtectedRoute area="member">
            <MyTemplates />
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
      <Route
        path="/bases/:id"
        element={
          <ProtectedRoute area="member">
            <BaseHome />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/access"
        element={
          <ProtectedRoute area="member">
            <AccessManagement />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/activity"
        element={
          <ProtectedRoute area="member">
            <ActivityLog />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/template"
        element={
          <ProtectedRoute area="member">
            <BaseTemplateEditor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/curation"
        element={
          <ProtectedRoute area="member">
            <CurationBoard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/curation"
        element={
          <ProtectedRoute area="member">
            <CurationPool />
          </ProtectedRoute>
        }
      />
      <Route
        path="/curation/:taskId"
        element={
          <ProtectedRoute area="member">
            <CurationTask />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/cohorts"
        element={
          <ProtectedRoute area="member">
            <CohortBuilder />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/cohorts/:cohortId/export"
        element={
          <ProtectedRoute area="member">
            <ExportPanel />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/import"
        element={
          <ProtectedRoute area="member">
            <ImportData />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bases/:id/patients/new"
        element={
          <ProtectedRoute area="member">
            <PatientCreateChoice />
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
          <ProtectedRoute area="member">
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
        path="/bases/:id/patients/:patientId/encounters/new"
        element={
          <ProtectedRoute area="member">
            <EncounterCreateChoice />
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
          <ProtectedRoute area="member">
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
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
