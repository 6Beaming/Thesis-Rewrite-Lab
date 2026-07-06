import { Navigate, Route, Routes } from 'react-router';
import RequireSignIn from './components/RequireSignIn.jsx';
import Profile from './pages/Profile.jsx';
import WorkspacePage from './pages/WorkspacePage.jsx';

function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={(
          <RequireSignIn>
            <WorkspacePage />
          </RequireSignIn>
        )}
      />
      <Route path="/profile" element={<Profile />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
