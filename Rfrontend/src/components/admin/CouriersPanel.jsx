import { ChevronDown } from 'lucide-react'

import { money } from '../../lib/api.js'
import Field from './Field.jsx'

const dateLabel = (value, locale) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value))

function CourierCard({ account, t, onResetPassword, locale }) {
  const isCourier = account.role === 'repartidor'
  return (
    <article className="courier-card">
      <div className="courier-heading">
        <strong>{account.email}</strong>
        <span className={`courier-role ${isCourier ? 'is-courier' : 'is-admin'}`}>
          {t.couriers.roles[account.role] || account.role}
        </span>
        <small>{t.couriers.since} {dateLabel(account.createdAt, locale)}</small>
      </div>

      {isCourier && (
        <>
          <div className="courier-stats">
            <div className="stat-card">
              <span className="stat-label">{t.couriers.stats.delivered}</span>
              <strong className="stat-value">{account.deliveries}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">{t.couriers.stats.inProgress}</span>
              <strong className="stat-value">{account.inProgress}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">{t.couriers.stats.earned}</span>
              <strong className="stat-value">{money(account.earned, locale)}</strong>
            </div>
          </div>

          <details className="variant-create-box">
            <summary>{t.couriers.reset}<ChevronDown size={15} aria-hidden="true" /></summary>
            <form className="courier-reset" onSubmit={(event) => onResetPassword(event, account)}>
              <Field label={t.couriers.newPassword}>
                <input name="password" type="password" minLength="12" maxLength="200" autoComplete="new-password" required />
              </Field>
              <button className="button outline small" type="submit">{t.couriers.savePassword}</button>
            </form>
          </details>
        </>
      )}
    </article>
  )
}

export default function CouriersPanel({ t, accounts, loading, onCreateCourier, onResetPassword, locale }) {
  return (
    <section className="tab-panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">{t.couriers.eyebrow}</span>
          <h2>{t.couriers.title}</h2>
        </div>
        <span className="count-pill">{accounts.length}</span>
      </div>

      <p className="help-text">{t.couriers.help}</p>

      <details className="create-box">
        <summary>{t.couriers.add}<ChevronDown size={17} aria-hidden="true" /></summary>
        <form className="product-form" onSubmit={onCreateCourier}>
          <div className="form-grid">
            <Field label={t.couriers.email}>
              <input name="email" type="email" maxLength="150" autoComplete="off" required />
            </Field>
            <Field label={t.couriers.password}>
              <input name="password" type="password" minLength="12" maxLength="200" autoComplete="new-password" required />
            </Field>
            <Field label={t.couriers.confirm}>
              <input name="confirm" type="password" minLength="12" maxLength="200" autoComplete="new-password" required />
            </Field>
          </div>
          <p className="help-text">{t.couriers.passwordHint}</p>
          <button className="button primary" type="submit">{t.couriers.create}</button>
        </form>
      </details>

      <div className="order-list">
        {accounts.length ? accounts.map((account) => (
          <CourierCard
            key={account.id}
            account={account}
            t={t}
            onResetPassword={onResetPassword}
            locale={locale}
          />
        )) : (
          <p className="empty">{loading ? t.couriers.loading : t.couriers.empty}</p>
        )}
      </div>
    </section>
  )
}
