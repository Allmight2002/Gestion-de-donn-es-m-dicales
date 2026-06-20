import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute, PublicOnly } from './ProtectedRoute';
import { LoginScreen } from '../screens/LoginScreen';
import { ResetPassword } from '../screens/ResetPassword';
import { Dashboard } from '../screens/member/Dashboard';
import { BaseHome } from '../screens/member/BaseHome';
import { BaseTemplateEditor } from '../screens/member/BaseTemplateEditor';
import { NewPatient } from '../screens/member/NewPatient';
import { PatientCreateChoice } from '../screens/member/PatientCreateChoice';
import { EncounterCreateChoice } from '../screens/member/EncounterCreateChoice';
import { PatientDetail } from '../screens/member/PatientDetail';
import { EncounterForm } from '../screens/member/EncounterForm';
import { EditEncounter } from '../screens/member/EditEncounter';
import { AddImage } from '../screens/member/AddImage';
import { CohortBuilder } from '../screens/member/CohortBuilder';
import { ExportPanel } from '../screens/member/ExportPanel';
import { AccessManagement } from '../screens/member/AccessManagement';
import { CurationBoard } from '../screens/member/CurationBoard';
import { CurationPool } from '../screens/member/CurationPool';
import { CurationTask } from '../screens/member/CurationTask';
import { AcceptInvitation } from '../screens/member/AcceptInvitation';
import { TemplatesAdmin } from '../screens/staff/TemplatesAdmin';
import { RoleAdmin } from '../screens/staff/RoleAdmin';
import { NotFound } from '../screens/NotFound';

export function AppRoutes() {
  return (
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
  );
}
