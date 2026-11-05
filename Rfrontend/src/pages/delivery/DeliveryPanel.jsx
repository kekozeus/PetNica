import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'

import { apiRequest, money } from '../../lib/api.js'
import { useLanguage } from '../../lib/useLanguage.js'
import { deliveryTranslations } from '../../features/delivery/delivery.js'
import './delivery.css'

import brandIcon from '../../assets/icon.png'
import DeliveryOrderCard from '../../components/delivery/DeliveryOrderCard.jsx'
import DeliveryOrderDetail from '../../components/delivery/DeliveryOrderDetail.jsx'

export default function DeliveryPanel() {
  const { language, setLanguage, t, locale } = useLanguage(deliveryTranslations)
  const formatMoney = (value) => money(value, locale)
  const formatDate = (value) => new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })

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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ text: '', error: false })
  const [selected, setSelected] = useState(null)

  const request = useCallback(async (url, options = {}) => {
    try {
      return await apiRequest(url, options, csrf.current)
    } catch (error) {
      if (error.status === 401) { csrf.current = ''; setEmail(''); setData(null); setSelected(null) }
      throw error
    }
  }, [])

  const notify = useCallback((text, error = false) => {
    setMessage({ text, error })
    if (text) setTimeout(() => setMessage({ text: '', error: false }), 6000)
  }, [])

  const refresh = useCallback(async () => {
    const result = await request('/api/delivery/orders')
    setData(result)
    return result
  }, [request])

  useEffect(() => {
    let mounted = true
    apiRequest('/api/delivery/session').then(async (session) => {
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
  }, [refresh])

  async function login(event) {
    event.preventDefault()
    setBusy(true)
    setLoginError('')
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      const session = await request('/api/delivery/login', {
        method: 'POST',
        body: { email: values.get('email'), password: values.get('password') },
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
      await request('/api/delivery/logout', { method: 'POST' })
    } catch {}
    csrf.current = ''
    setEmail('')
    setData(null)
    setSelected(null)
    setLoginError('')
  }

  function handleUpdated(nextOrder, text) {
    if (nextOrder) setSelected(nextOrder)
    else setSelected(null)
    if (text) notify(text)
    refresh().catch(() => {})
  }

  function openOrder(order) {
    setSelected(order)
    window.scrollTo({ top: 0 })
  }

  if (loading) {
    return (
      <motion.main className="delivery-main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: '15vh', textAlign: 'center', color: 'var(--muted)', fontWeight: 800 }}>
        {t.messages.loading}
      </motion.main>
    )
  }

  const header = (
    <header className="delivery-header">
      <a className="brand" href="/" aria-label="PetNica">
        <img src={brandIcon} alt="" />
        <span>PetNica</span>
      </a>
      <div className="delivery-header-tools">
        <a className="back-link" href="/">{t.back}</a>
        <label className="language-picker">
          <span className="visually-hidden">{t.language}</span>
          <select aria-label={t.language} value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="es">{t.spanish}</option>
            <option value="en">{t.english}</option>
          </select>
        </label>
      </div>
    </header>
  )

  if (!email) {
    return (
      <>
        {header}
        <main className="delivery-main">
          <motion.section className="login-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <span className="eyebrow">{t.login.eyebrow}</span>
            <h1>{t.login.title}</h1>
            <p>{t.login.description}</p>
            <form onSubmit={login}>
              <label>{t.login.email}
                <input name="email" type="email" autoComplete="username" maxLength="150" required />
              </label>
              <label>{t.login.password}
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              {loginError && <p className="message error" role="alert">{loginError}</p>}
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? t.login.loading : t.login.submit}
              </button>
            </form>
            <small>{t.login.note}</small>
          </motion.section>
        </main>
      </>
    )
  }

  const earnings = data?.earnings || { earned: '0.00', pending: '0.00', deliveredCount: 0 }
  const orders = data?.orders || []
  const delivered = data?.delivered || []

  return (
    <>
      {header}
      <main className="delivery-main">
        {selected ? (
          <DeliveryOrderDetail
            t={t}
            order={selected}
            request={request}
            formatMoney={formatMoney}
            formatDate={formatDate}
            onBack={() => setSelected(null)}
            onUpdated={handleUpdated}
          />
        ) : (
          <>
            <div className="welcome">
              <div>
                <span className="eyebrow">{t.panel.eyebrow}</span>
                <h1>{t.panel.title}</h1>
                <p>{t.panel.sessionStarted.replace('{email}', email)}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="button outline" type="button" onClick={() => refresh().catch((e) => notify(e.message, true))}>
                  <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" /> {t.panel.refresh}
                </button>
                <button className="button outline" type="button" onClick={logout}>{t.panel.logout}</button>
              </div>
            </div>

            <div className="earnings-grid">
              <div className="earning-card is-earned">
                <b>{formatMoney(earnings.earned)}</b>
                <span>{t.earnings.earned}</span>
              </div>
              <div className="earning-card is-pending">
                <b>{formatMoney(earnings.pending)}</b>
                <span>{t.earnings.pending}</span>
              </div>
              <div className="earning-card">
                <b>{earnings.deliveredCount}</b>
                <span>{t.earnings.delivered}</span>
              </div>
            </div>
            <p className="earnings-help">{t.earnings.help}</p>

            {message.text && (
              <p className={`message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>
                {message.text}
              </p>
            )}

            <div className="section-title">
              <div>
                <span className="eyebrow">{t.orders.eyebrow}</span>
                <h2>{t.orders.title}</h2>
              </div>
              <span className="count-pill">{orders.length}</span>
            </div>
            <p className="help-text">{t.orders.help}</p>

            {!data ? (
              <div className="empty">{t.messages.unavailable}</div>
            ) : !orders.length ? (
              <div className="empty">{t.orders.empty}</div>
            ) : (
              <div className="order-list">
                {orders.map((order) => (
                  <DeliveryOrderCard
                    key={order.id}
                    t={t}
                    order={order}
                    onOpen={openOrder}
                    formatMoney={formatMoney}
                    formatDate={formatDate}
                  />
                ))}
              </div>
            )}

            <div className="section-title" style={{ marginTop: 34 }}>
              <div>
                <span className="eyebrow">{t.history.eyebrow}</span>
                <h2>{t.history.title}</h2>
              </div>
              <span className="count-pill">{delivered.length}</span>
            </div>

            {!delivered.length ? (
              <div className="empty">{t.history.empty}</div>
            ) : (
              <div className="history-list">
                {delivered.map((item) => (
                  <div className="history-item" key={item.id}>
                    <b>{t.history.order} #{item.id}</b>
                    <span className="muted">{item.deliveredAt ? formatDate(item.deliveredAt) : ''}</span>
                    {item.recipientName && <span className="muted">{t.history.recipient}: {item.recipientName}</span>}
                    <span className="earn">+ {formatMoney(item.shipping)}</span>
                    <span className="links">
                      {item.videoUrl && <a href={item.videoUrl} target="_blank" rel="noopener noreferrer">{t.history.video}</a>}
                      {item.signatureData && <a href={item.signatureData} target="_blank" rel="noopener noreferrer">{t.history.signature}</a>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  )
}
