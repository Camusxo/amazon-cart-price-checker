import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ImportPage from './pages/ImportPage';
import RunPage from './pages/RunPage';
import HistoryPage from './pages/HistoryPage';
import ComparePage from './pages/ComparePage';

function App() {
  return (
    <HashRouter>
        <Routes>
            <Route path="/" element={<Layout />}>
                <Route index element={<ImportPage />} />
                <Route path="results/:runId" element={<RunPage />} />
                <Route path="compare/:compareId" element={<ComparePage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    </HashRouter>
  );
}

export default App;
