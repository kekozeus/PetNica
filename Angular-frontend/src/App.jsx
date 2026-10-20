import { lazy, Suspense, useEffect } from 'react'
import brandIcon from './assets/icon.png'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { motion } from 'framer-motion'
import './App.css'

const Storefront = lazy(() => import('./features/store/Storefront.jsx'))
const AdminPanel = lazy(() => import('./features/admin/AdminPanel.jsx'))

function App() {
  useEffect(() => {
    let icon = document.querySelector('link[rel="icon"]')
    if (!icon) {
      icon = document.createElement('link')
      icon.rel = 'icon'
      document.head.append(icon)
    }
    icon.type = 'image/png'
    icon.href = brandIcon
  }, [])

  return (
    <BrowserRouter>
      <Suspense fallback={<motion.main className="wrap empty min-h-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Cargando PetNica…</motion.main>}>
        <Routes>
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="*" element={<Storefront />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
