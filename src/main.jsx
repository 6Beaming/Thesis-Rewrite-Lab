import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import { AuthProvider } from './components/AuthProvider.jsx';
import { RealtimeProvider } from './components/RealtimeProvider.jsx';
import './styles/index.css';

// Remove data written by the retired offline/demo persistence path.
window.localStorage.removeItem('project-thesis-rewriter:demo-store:v1');
window.localStorage.removeItem('project-thesis-rewriter:local-profile-picture:v1');
window.sessionStorage.removeItem('project-thesis-rewriter:last-workspace-document:v1');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RealtimeProvider>
          <App />
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
