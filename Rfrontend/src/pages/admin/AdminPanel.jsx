import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

import { apiRequest } from '../../lib/api.js'
import { useLanguage } from '../../lib/useLanguage.js'
import { adminTranslations } from '../../features/admin/admin.js'
import './admin.css'

import AdminFooter from '../../components/admin/AdminFooter.jsx'
import AdminHeader from '../../components/admin/AdminHeader.jsx'
import CouriersPanel from '../../components/admin/CouriersPanel.jsx'
import FinancesPanel from '../../components/admin/FinancesPanel.jsx'
import LoginCard from '../../components/admin/LoginCard.jsx'
import OrdersPanel from '../../components/admin/OrdersPanel.jsx'
import ProductsPanel from '../../components/admin/ProductsPanel.jsx'

export default function AdminPanel() {
  const { language, setLanguage, t, locale } = useLanguage(adminTranslations)
  const orderStatuses = {
    pendiente: t.states.pending,
    confirmado: t.states.confirmed,
    preparando: t.states.preparing,
    en_camino: t.states.onTheWay,
    entregado: t.states.delivered,
    cancelado: t.states.canceled
  }
  const paymentStatuses = {
    pendiente: t.states.pending,
    verificado: t.states.verified,
    rechazado: t.states.rejected
  }

  useEffect(() => {
    const previousLanguage = document.documentElement.lang
    const previousTitle = document.title
    let robots = document.querySelector('meta[name="robots"]')
    const createdRobots = !robots
    if (createdRobots) {
      robots = document.createElement('meta')
      robots.name = 'robots'
      document.head.append(robots)
    }
    const previousRobots = robots.content
    document.documentElement.lang = language
    document.title = t.documentTitle
    robots.content = 'noindex,nofollow'
    return () => {
      document.documentElement.lang = previousLanguage
      document.title = previousTitle
      if (createdRobots) robots.remove()
      else robots.content = previousRobots
    }
  }, [language, t.documentTitle])

  const csrf = useRef('')
  const [email, setEmail] = useState('')
  const [overview, setOverview] = useState(null)
  const [finances, setFinances] = useState(null)
  const [financesLoading, setFinancesLoading] = useState(false)
  const [finPages, setFinPages] = useState({ expenses: 1, payroll: 1, taxes: 1, purchases: 1 })
  const [couriers, setCouriers] = useState(null)
  const [couriersLoading, setCouriersLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [message, setMessage] = useState({ text: '', error: false })
  const [tab, setTab] = useState('products')
  const [busy, setBusy] = useState(false)
  const [productQuery, setProductQuery] = useState('')
  const [orderQuery, setOrderQuery] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')

  const request = useCallback(async (url, options = {}) => {
    try {
      return await apiRequest(url, options, csrf.current)
    } catch (error) {
      if (error.status === 401) { csrf.current = ''; setEmail(''); setOverview(null); setFinances(null); setCouriers(null) }
      throw error
    }
  }, [])

  const notify = useCallback((text, error = false) => {
    setMessage({ text, error })
    if (text) setTimeout(() => setMessage({ text: '', error: false }), 5000)
  }, [])

  const refresh = useCallback(async () => {
    const result = await request('/api/admin/overview')
    setOverview(result)
  }, [request])

  const loadFinances = useCallback(async (pages) => {
    const next = pages || finPages
    setFinancesLoading(true)
    try {
      const qs = new URLSearchParams()
      for (const key of ['expenses', 'payroll', 'taxes', 'purchases']) {
        if (next[key] > 1) qs.set(`${key}Page`, String(next[key]))
      }
      const result = await request(`/api/admin/finances${qs.size ? `?${qs}` : ''}`)
      setFinances(result)
      setFinPages(next)
    } catch (error) {
      notify(error.message, true)
    } finally {
      setFinancesLoading(false)
    }
  }, [finPages, notify, request])

  const loadCouriers = useCallback(async () => {
    setCouriersLoading(true)
    try {
      const result = await request('/api/admin/couriers')
      setCouriers(result.accounts || [])
    } catch (error) {
      notify(error.message, true)
    } finally {
      setCouriersLoading(false)
    }
  }, [notify, request])

  useEffect(() => {
    if (tab !== 'finances' || finances || !overview) return
    const id = setTimeout(() => { void loadFinances() }, 0)
    return () => clearTimeout(id)
  }, [tab, finances, overview, loadFinances])

  useEffect(() => {
    if (tab !== 'couriers' || couriers || !overview) return
    const id = setTimeout(() => { void loadCouriers() }, 0)
    return () => clearTimeout(id)
  }, [tab, couriers, overview, loadCouriers])

  const filteredProducts = (overview?.products || []).filter((product) => {
    const query = productQuery.trim().toLocaleLowerCase(locale)
    if (!query) return true
    const searchable = [
      product.name,
      product.slug,
      product.category,
      ...(product.variants || []).flatMap((variant) => [variant.sku, variant.presentation]),
    ].join(' ').toLocaleLowerCase(locale)
    return searchable.includes(query)
  })

  const filteredOrders = (overview?.orders || []).filter((order) => {
    const query = orderQuery.trim().toLocaleLowerCase(locale)
    const matchesSearch = !query || [order.id, order.firstName, order.lastName, order.email, order.phone]
      .join(' ').toLocaleLowerCase(locale).includes(query)
    return matchesSearch && (orderStatusFilter === 'all' || order.status === orderStatusFilter)
  })

  useEffect(() => {
    let mounted = true
    apiRequest('/api/admin/session').then(async (session) => {
      if (!mounted) return
      if (!session.authenticated) { setLoading(false); return }
      csrf.current = session.csrfToken || ''
      setEmail(session.email)
      await refresh()
    }).catch((error) => {
      if (mounted) setLoginError(error.message)
    }).finally(() => {
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [refresh, request])

  async function login(event) {
    event.preventDefault()
    setBusy(true)
    setLoginError('')
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      const session = await request('/api/admin/login', {
        method: 'POST',
        body: {
          email: data.get('email'),
          password: data.get('password')
        }
      })
      csrf.current = session.csrfToken || ''
      setEmail(session.email)
      await refresh()
      form.reset()
    } catch (error) {
      setLoginError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      await request('/api/admin/logout', { method: 'POST' })
      csrf.current = ''
      setEmail('')
      setOverview(null)
      setFinances(null)
      setLoginError('')
    } catch (error) {
      notify(error.message, true)
    }
  }

  async function createProduct(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      await request('/api/admin/products', {
        method: 'POST',
        body: Object.fromEntries([
          'name',
          'slug',
          'description',
          'categoryId',
          'species',
          'sku',
          'presentation',
          'price',
          'stock'
        ].map((key) => [key, values.get(key)]))
      })
      form.reset()
      await refresh()
      notify(t.messages.created)
    } catch (error) {
      notify(error.message, true)
    }
  }

  async function updateProduct(event, product) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    try {
      await request(`/api/admin/products/${product.id}`, {
        method: 'PUT',
        body: {
          name: data.get('name'),
          slug: data.get('slug'),
          description: data.get('description'),
          categoryId: data.get('categoryId'),
          species: data.get('species'),
          active: data.has('active')
        }
      })
      await refresh()
      notify(t.messages.updated)
    } catch (error) {
      notify(error.message, true)
    }
  }

  async function updateVariant(event, variant) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    try {
      await request(`/api/admin/variants/${variant.id}`, {
        method: 'PUT',
        body: {
          sku: data.get('sku'),
          presentation: data.get('presentation'),
          price: data.get('price'),
          stock: data.get('stock'),
          active: data.has('active')
        }
      })
      await refresh()
      notify(t.messages.variantUpdated)
    } catch (error) {
      notify(error.message, true)
    }
  }

  async function createVariant(event, product) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      await request(`/api/admin/products/${product.id}/variants`, {
        method: 'POST',
        body: {
          sku: data.get('sku'),
          presentation: data.get('presentation'),
          price: data.get('price'),
          stock: data.get('stock')
        }
      })
      form.reset()
      await refresh()
      notify(t.messages.variantAdded)
    } catch (error) {
      notify(error.message, true)
    }
  }

  async function uploadImage(form, product) {
    const file = new FormData(form).get('image')
    if (!file?.size) return false
    const data = new FormData()
    data.append('image', file)
    try {
      await request(`/api/admin/products/${product.id}/image`, {
        method: 'POST',
        body: data
      })
      await refresh()
      notify(t.messages.imageUpdated)
      return true
    } catch (error) {
      notify(error.message, true)
      return false
    }
  }

  async function removeImage(product) {
    try {
      await request(`/api/admin/products/${product.id}/image`, { method: 'DELETE' })
      await refresh()
      notify(t.messages.imageRemoved)
    } catch (error) {
      notify(error.message, true)
    }
  }

  async function createCourier(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    if (data.get('password') !== data.get('confirm')) {
      notify(t.couriers.passwordMismatch, true)
      return
    }
    try {
      await request('/api/admin/couriers', {
        method: 'POST',
        body: { email: data.get('email'), password: data.get('password') }
      })
      form.reset()
      await loadCouriers()
      notify(t.messages.courierCreated)
    } catch (error) {
      notify(error.message, true)
    }
  }

  async function resetCourierPassword(event, account) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      await request(`/api/admin/couriers/${account.id}/password`, {
        method: 'PUT',
        body: { password: data.get('password') }
      })
      form.reset()
      notify(t.messages.courierPasswordUpdated)
    } catch (error) {
      notify(error.message, true)
    }
  }

  async function changeOrder(order, field, value) {
    const endpoint = field === 'status' ? 'status' : 'payment'
    try {
      await request(`/api/admin/orders/${order.id}/${endpoint}`, {
        method: 'PUT',
        body: { status: value }
      })
      await refresh()
      notify(field === 'status' ? t.messages.orderUpdated : t.messages.paymentUpdated)
    } catch (error) {
      notify(error.message, true)
      await refresh()
    }
  }

  if (loading) return (
    <motion.main className="wrap empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{t.messages.loading}</motion.main>
  )

  return (
    <>
      <AdminHeader t={t} language={language} setLanguage={setLanguage} />

      <main className="admin-main">
        {!overview ? (
          <LoginCard t={t} loginError={loginError} busy={busy} onSubmit={login} />
        ) : (
          <>
            <div className="welcome">
              <div>
                <span className="eyebrow">{t.panel.eyebrow}</span>
                <h1>{t.panel.title}</h1>
                <p>{t.messages.sessionStarted.replace('{email}', email)}</p>
              </div>
              <button className="button outline" type="button" onClick={logout}>{t.panel.logout}</button>
            </div>

            <nav className="tabs" aria-label={t.panel.tabsAria}>
              <button type="button" aria-pressed={tab === 'products'} onClick={() => setTab('products')}>
                {t.panel.productsTab}
              </button>
              <button type="button" aria-pressed={tab === 'orders'} onClick={() => setTab('orders')}>
                {t.panel.ordersTab}
              </button>
              <button type="button" aria-pressed={tab === 'finances'} onClick={() => setTab('finances')}>
                {t.panel.financesTab}
              </button>
              <button type="button" aria-pressed={tab === 'couriers'} onClick={() => setTab('couriers')}>
                {t.panel.couriersTab}
              </button>
            </nav>

            {message.text && (
              <p className={`message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>
                {message.text}
              </p>
            )}

            {tab === 'products' ? (
              <ProductsPanel
                t={t}
                overview={overview}
                filteredProducts={filteredProducts}
                productQuery={productQuery}
                onProductQuery={setProductQuery}
                onCreateProduct={createProduct}
                onUpdateProduct={updateProduct}
                onUpdateVariant={updateVariant}
                onCreateVariant={createVariant}
                onUploadImage={uploadImage}
                onRemoveImage={removeImage}
              />
            ) : tab === 'orders' ? (
              <OrdersPanel
                t={t}
                overview={overview}
                filteredOrders={filteredOrders}
                orderQuery={orderQuery}
                onOrderQuery={setOrderQuery}
                orderStatusFilter={orderStatusFilter}
                onStatusFilter={setOrderStatusFilter}
                orderStatuses={orderStatuses}
                paymentStatuses={paymentStatuses}
                onChangeOrder={changeOrder}
                request={request}
                locale={locale}
              />
            ) : tab === 'couriers' ? (
              <CouriersPanel
                t={t}
                accounts={couriers || []}
                loading={couriersLoading}
                onCreateCourier={createCourier}
                onResetPassword={resetCourierPassword}
                locale={locale}
              />
            ) : (
              <FinancesPanel
                t={t}
                finances={finances}
                loading={financesLoading}
                onPage={(key, page) => loadFinances({ ...finPages, [key]: page })}
                onRefresh={() => loadFinances()}
                locale={locale}
              />
            )}
          </>
        )}
      </main>

      <AdminFooter t={t} />
    </>
  )
}
