import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './App';
import { NotifyProvider } from './components/notify';
import { AuthProvider } from './lib/auth';
import { createClient } from './lib/client';
import './styles.css';

const client = createClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider client={client}>
        <NotifyProvider>
          <AppRoutes />
        </NotifyProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
