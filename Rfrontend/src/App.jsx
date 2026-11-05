import { lazy, Suspense } from 'react'
import brandIcon from './assets/icon.png'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import './App.css'

const Storefront = lazy(() => import('./pages/store/Storefront.jsx'))
const AdminPanel = lazy(() => import('./pages/admin/AdminPanel.jsx'))
const DeliveryPanel = lazy(() => import('./pages/delivery/DeliveryPanel.jsx'))
const InfoPage = lazy(() => import('./pages/info/InfoPage.jsx'))

function LoadingScreen() {
  const prefersReducedMotion = useReducedMotion()

  return (
    <motion.main
      className="app-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.25 }}
    >
      <div className="loading-content">
        <div className="loading-mark" aria-hidden="true">
          <motion.span
            className="loading-spinner"
            animate={{ rotate: prefersReducedMotion ? 0 : 360 }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 1.35, repeat: Infinity, ease: 'linear' }}
          />
          <img className="loading-icon" src={brandIcon} alt="" />
        </div>
        <p className="loading-label">Cargando <strong>PetNica</strong></p>
      </div>
    </motion.main>
  )
}

function ClientPathRedirect() {
  const location = useLocation()
  let path = location.pathname.replace(/^\/client/, '') || '/'
  if (path === '/index.html') path = '/'
  return <Navigate to={`${path}${location.search}${location.hash}`} replace />
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/client/*" element={<ClientPathRedirect />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/admin/login" element={<AdminPanel />} />
          <Route path="/repartidor" element={<DeliveryPanel />} />
          <Route path="/repartidor/login" element={<DeliveryPanel />} />
          <Route path="/proceso-de-compra" element={<InfoPage pageId="purchase" />} />
          <Route path="/contacto" element={<InfoPage pageId="contact" />} />
          <Route path="/acerca-de-nosotros" element={<InfoPage pageId="about" />} />
          <Route path="/preguntas-frecuentes" element={<InfoPage pageId="faq" />} />
          <Route path="/politica-de-privacidad" element={<InfoPage pageId="privacy" />} />
          <Route path="/politica-de-devoluciones" element={<InfoPage pageId="returns" />} />
          <Route path="/politica-de-envios" element={<InfoPage pageId="shipping" />} />
          <Route path="/condiciones-de-compra" element={<InfoPage pageId="terms" />} />
          <Route path="*" element={<Storefront />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
