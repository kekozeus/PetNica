import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Lock, PawPrint, X } from 'lucide-react'

import { apiRequest } from '../../lib/api.js'

export default function AccountDialog({ open, onClose, customer, adminSession, csrf, setCsrf, onAuth, onLogout, googleConfigured, error, setError, loadOrders, orders, onInvoice, prefersReducedMotion, t, locale, formatMoney }) {
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && customer) loadOrders()
  }, [open, customer, loadOrders])

  async function submit(event, endpoint) {
    event.preventDefault()
    setBusy(true)
    setError('')

    const form = event.currentTarget
    const payload = Object.fromEntries(new FormData(form).entries())

    try {
      const result = await apiRequest(endpoint, { method: 'POST', body: payload }, csrf)
      setCsrf(result.csrfToken || '')
      await onAuth(result)
      form.reset()
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop account-backdrop"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
        >
          <motion.section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="accountTitle"
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 18, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: prefersReducedMotion ? 0 : 12, scale: .98 }}
            transition={{ duration: prefersReducedMotion ? 0 : .22 }}
          >
            <div className="account-head">
              <div>
                <span className="eyebrow">{t.account.eyebrow}</span>
                <h2 id="accountTitle">{t.account.title}</h2>
              </div>
              <button className="close-btn" type="button" aria-label={t.account.close} onClick={onClose}>
                <X size={20} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>

            {customer ? (
              <>
                <div className="customer-summary">
                  <span className="customer-avatar" aria-hidden="true"><PawPrint size={20} strokeWidth={1.8} /></span>
                  <div>
                    <b>{customer.firstName} {customer.lastName}</b>
                    <small>{customer.email}</small>
                  </div>
                  <button className="btn alt account-logout" type="button" onClick={onLogout}>{t.account.logout}</button>
                </div>

                <div className="orders-heading">
                  <div>
                    <span className="eyebrow">{t.account.history}</span>
                    <h3>{t.account.orders}</h3>
                  </div>
                </div>

                <div className="customer-orders">
                  {orders === null ? (
                    <p className="empty">{t.account.loadingOrders}</p>
                  ) : orders.length ? orders.map((order) => (
                    <article className="customer-order" key={order.id}>
                      <div className="customer-order-top">
                        <b>{t.cart.title} #{order.id} · {formatMoney(order.total)}</b>
                        <time>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(order.createdAt))}</time>
                      </div>

                      <ul>
                        {order.items.map((item, i) => (
                          <li key={i}>{item.quantity} × {item.name} · {formatMoney(Number(item.unitPrice) * Number(item.quantity))}</li>
                        ))}
                        {order.petboxName && <li>1 × {order.petboxName}</li>}
                      </ul>

                      <small>{order.shippingAddress}</small>

                      <div className="customer-order-bottom">
                        <span className="status-label">{t.order.status[order.status] || order.status}</span>
                        <button className="invoice-button" type="button" onClick={() => onInvoice(order)}>{t.account.invoice}</button>
                      </div>
                    </article>
                  )) : (
                    <p className="empty">{t.account.noOrders}</p>
                  )}
                </div>
              </>
            ) : adminSession ? (
              <section className="auth-section account-admin-notice">
                <Lock size={32} strokeWidth={1.6} aria-hidden="true" />
                <h3>{t.account.adminSessionTitle}</h3>
                <p className="auth-description">{t.account.adminSessionNotice}</p>
                <Link className="btn" to="/admin/login" onClick={onClose}>{t.account.adminSessionCta}</Link>
              </section>
            ) : (
              <>
                <p className="sub">{t.account.loginIntro}</p>

                <div className="auth-switch" role="group" aria-label={t.account.accessMode}>
                  <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError('') }}>
                    {t.account.login}
                  </button>
                  <button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError('') }}>
                    {t.account.register}
                  </button>
                </div>

                {googleConfigured && (
                  <>
                    <a className="google-button" href="/api/account/google"><span>G</span> {t.account.google}</a>
                    <div className="auth-divider"><span>{t.account.orEmail}</span></div>
                  </>
                )}

                {mode === 'login' ? (
                  <section className="auth-section">
                    <h3>{t.account.welcome}</h3>
                    <p className="auth-description">{t.account.loginDescription}</p>

                    <form className="account-form" onSubmit={(event) => submit(event, '/api/account/login')}>
                      <label>{t.account.email}
                        <input name="email" type="email" autoComplete="email" maxLength="150" required />
                      </label>
                      <label>{t.account.password}
                        <input name="password" type="password" autoComplete="current-password" required />
                      </label>
                      <button className="btn" disabled={busy}>{busy ? t.account.signingIn : t.account.login}</button>
                    </form>
                  </section>
                ) : (
                  <section className="auth-section">
                    <h3>{t.account.registerTitle}</h3>
                    <p className="auth-description">{t.account.registerDescription}</p>

                    <form className="account-form" onSubmit={(event) => submit(event, '/api/account/register')}>
                      <div className="form-grid">
                        <label>{t.account.firstName}
                          <input name="firstName" autoComplete="given-name" maxLength="80" required />
                        </label>
                        <label>{t.account.lastName}
                          <input name="lastName" autoComplete="family-name" maxLength="80" required />
                        </label>
                      </div>
                      <label>{t.account.email}
                        <input name="email" type="email" autoComplete="email" maxLength="150" required />
                      </label>
                      <label>{t.account.phone}
                        <input name="phone" type="tel" autoComplete="tel" maxLength="20" placeholder="+505 8888 0000" />
                      </label>
                      <label>{t.account.password}
                        <input name="password" type="password" autoComplete="new-password" minLength="12" required />
                        <small>{t.account.passwordHelp}</small>
                      </label>
                      <button className="btn" disabled={busy}>{busy ? t.account.creatingAccount : t.account.createAccount}</button>
                    </form>
                  </section>
                )}

                {error && <p className="account-error" role="alert">{error}</p>}

                <p className="account-note">{t.account.secureNote}</p>

                <p className="account-admin-entry">
                  <span>{t.account.adminPrompt}</span>
                  <Link to="/admin/login">{t.account.adminAccess}<ArrowUpRight size={13} aria-hidden="true" /></Link>
                </p>
              </>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
