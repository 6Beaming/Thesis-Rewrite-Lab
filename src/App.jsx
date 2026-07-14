import { Navigate, Route, Routes } from 'react-router';
import RequireSignIn from './components/RequireSignIn.jsx';
import RequirePro from './components/RequirePro.jsx';
import Profile from './pages/Profile.jsx';
import WorkspacePage from './pages/WorkspacePage.jsx';
import HomepageSubscription from './pages/homepageSubscription.jsx';

function ProtectedRoute({ children }) {
  return (
    <RequireSignIn>
      <RequirePro>{children}</RequirePro>
    </RequireSignIn>
  );
}

function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={(
          <ProtectedRoute>
            <WorkspacePage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/workspace/:documentId"
        element={(
          <ProtectedRoute>
            <WorkspacePage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/profile"
        element={(
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/subscription"
        element={(
          <RequireSignIn>
            <HomepageSubscription />
          </RequireSignIn>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
