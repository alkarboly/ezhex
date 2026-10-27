import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { DatasetsPage } from '../pages/DatasetsPage'
import { ExplorerPage } from '../pages/ExplorerPage'
import { JobsPage } from '../pages/JobsPage'
import { SavedQueriesPage } from '../pages/SavedQueriesPage'
import { SettingsPage } from '../pages/SettingsPage'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<ExplorerPage />} />
          <Route path="workflows" element={<SavedQueriesPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="saved" element={<Navigate to="/workflows" replace />} />
          <Route path="datasets" element={<DatasetsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
