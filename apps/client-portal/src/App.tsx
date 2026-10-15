import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './components/RequireAuth';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage';
import { AccountPage } from './pages/AccountPage';
import { LoginPage } from './pages/LoginPage';
import { MatterPage } from './pages/MatterPage';
import { MattersPage } from './pages/MattersPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** Route table. The caller supplies the router and the AuthProvider (so tests can inject a fake API). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite" element={<AcceptInvitationPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<MattersPage />} />
          <Route path="matters/:id" element={<MatterPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
