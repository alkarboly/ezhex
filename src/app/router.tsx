import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { DatasetsPage } from '../pages/DatasetsPage'
import { ExplorerPage } from '../pages/ExplorerPage'
import { SavedQueriesPage } from '../pages/SavedQueriesPage'
import { SettingsPage } from '../pages/SettingsPage'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<ExplorerPage />} />
          <Route path="saved" element={<SavedQueriesPage />} />
          <Route path="datasets" element={<DatasetsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
