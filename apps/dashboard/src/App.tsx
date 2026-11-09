import type { ReactNode } from 'react';
import type { Permission } from '@assar/types';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth, RequirePermission } from './components/RequireAuth';
import { PeopleProvider } from './lib/people';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AiPage } from './pages/AiPage';
import { AskPage } from './pages/AskPage';
import { AuditPage } from './pages/AuditPage';
import { CalendarPage } from './pages/CalendarPage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { ClientsPage } from './pages/ClientsPage';
import { ConflictsPage } from './pages/ConflictsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { LoginPage } from './pages/LoginPage';
import { MatterDetailPage } from './pages/MatterDetailPage';
import { MattersPage } from './pages/MattersPage';
import { MfaSetupPage } from './pages/MfaSetupPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignupPage } from './pages/SignupPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TasksPage } from './pages/TasksPage';
import { TeamPage } from './pages/TeamPage';
import { TimePage } from './pages/TimePage';

const guard = (permission: Permission, page: ReactNode) => (
  <RequirePermission permission={permission}>{page}</RequirePermission>
);

/** Route table. The caller supplies the router and the AuthProvider (so tests can inject a fake API). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/invite" element={<AcceptInvitePage />} />
      <Route element={<RequireAuth />}>
        <Route
          element={
            <PeopleProvider>
              <AppShell />
            </PeopleProvider>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="ask" element={guard('assistant:use', <AskPage />)} />
          <Route path="mfa-setup" element={<MfaSetupPage />} />
          <Route path="clients" element={guard('client:read', <ClientsPage />)} />
          <Route path="clients/:id" element={guard('client:read', <ClientDetailPage />)} />
          <Route path="matters" element={guard('matter:read', <MattersPage />)} />
          <Route path="matters/:id" element={guard('matter:read', <MatterDetailPage />)} />
          <Route path="documents" element={guard('document:read', <DocumentsPage />)} />
          <Route path="templates" element={guard('document:read', <TemplatesPage />)} />
          <Route path="tasks" element={guard('task:write', <TasksPage />)} />
          <Route path="calendar" element={guard('calendar:write', <CalendarPage />)} />
          <Route path="ai" element={guard('ai:use', <AiPage />)} />
          <Route path="conflicts" element={guard('conflict:check', <ConflictsPage />)} />
          <Route path="time" element={guard('time:write', <TimePage />)} />
          <Route path="invoices" element={guard('billing:read', <InvoicesPage />)} />
          <Route path="invoices/:id" element={guard('billing:read', <InvoiceDetailPage />)} />
          <Route path="reports" element={guard('billing:read', <ReportsPage />)} />
          <Route path="team" element={guard('user:manage', <TeamPage />)} />
          <Route path="audit" element={guard('audit:read', <AuditPage />)} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
