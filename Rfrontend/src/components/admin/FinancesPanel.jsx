import { useMemo } from 'react'
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'

import { money } from '../../lib/api.js'

const num = (value) => Number(value || 0)

function monthLabel(iso, locale) {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

function dayLabel(iso, locale) {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

function StatusPill({ status, statuses }) {
  return <span className={`order-status-pill fin-status-${status}`}>{statuses[status] || status}</span>
}

function Pagination({ t, section, loading, onPage }) {
  const { page, pageSize, total } = section
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  if (totalPages <= 1) return null
  return (
    <div className="fin-pagination">
      <button
        className="button outline small"
        type="button"
        disabled={loading || page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label={t.finances.pagination.prev}
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <span className="fin-page-indicator">
        {t.finances.pagination.page} {page} {t.finances.pagination.of} {totalPages}
      </span>
      <button
        className="button outline small"
        type="button"
        disabled={loading || page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label={t.finances.pagination.next}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

function RankedList({ items, max, accent }) {
  return (
    <div className={`fin-cat-list ${accent}`}>
      {items.map((item) => (
        <div className="fin-cat-row" key={item.key}>
          <span className="fin-cat-name" title={item.label}>{item.label}</span>
          <span className="fin-cat-bar" aria-hidden="true">
            <span style={{ width: `${Math.max((item.value / max) * 100, 3)}%` }} />
          </span>
          <span className="fin-cat-total">{item.total}</span>
          <span className="fin-cat-count">{item.count}</span>
        </div>
      ))}
    </div>
  )
}

export default function FinancesPanel({ t, finances, loading, onPage, onRefresh, locale }) {
  const derived = useMemo(() => {
    if (!finances) return null
    const months = finances.months || []
    const withActivity = months.filter((m) => num(m.grossSales) > 0 || num(m.operatingExpenses) > 0)
    const lastClosed = withActivity.filter((m) => num(m.grossSales) > 0).at(-1) || withActivity.at(-1)
    const taxesDue = (finances.taxes?.items || []).filter((x) => x.status === 'pendiente' || x.status === 'vencido')
    const purchasesDue = (finances.purchases?.items || []).filter((x) => x.status === 'pendiente' || x.status === 'parcial')
    const categories = (finances.expenseCategories || []).map((c) => ({
      key: c.category,
      label: t.finances.categories[c.category] || c.category,
      value: num(c.total),
      total: money(c.total, locale),
      count: c.count
    }))
    const suppliers = (finances.suppliers || []).map((s) => ({
      key: s.supplier,
      label: s.supplier,
      value: num(s.total),
      total: money(s.total, locale),
      count: s.count
    }))
    return {
      months, lastClosed, taxesDue, purchasesDue, categories, suppliers,
      maxCategory: Math.max(...categories.map((c) => c.value), 1),
      maxSupplier: Math.max(...suppliers.map((s) => s.value), 1)
    }
  }, [finances, t, locale])

  if (!finances || !derived) {
    return (
      <section className="tab-panel">
        <p className="empty">{loading ? t.finances.loading : t.finances.unavailable}</p>
      </section>
    )
  }

  const { months, lastClosed, taxesDue, purchasesDue, categories, suppliers, maxCategory, maxSupplier } = derived
  const goTo = (key) => (page) => onPage(key, page)

  return (
    <section className="tab-panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">{t.finances.eyebrow}</span>
          <h2>{t.finances.title}</h2>
        </div>
        <button className="button outline small" type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" /> {t.finances.refresh}
        </button>
      </div>

      <p className="help-text">{t.finances.help}</p>

      <div className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">{t.finances.stats.netSales}</span>
          <strong className="stat-value">{money(lastClosed?.netSales, locale)}</strong>
          <span className="stat-note">{lastClosed ? monthLabel(lastClosed.periodStart, locale) : '—'}</span>
        </article>
        <article className={`stat-card${num(lastClosed?.netProfit) < 0 ? ' negative' : ''}`}>
          <span className="stat-label">{t.finances.stats.netProfit}</span>
          <strong className="stat-value">{money(lastClosed?.netProfit, locale)}</strong>
          <span className="stat-note">{lastClosed ? monthLabel(lastClosed.periodStart, locale) : '—'}</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.finances.stats.taxesDue}</span>
          <strong className="stat-value">{money(taxesDue.reduce((sum, x) => sum + num(x.amount), 0), locale)}</strong>
          <span className="stat-note">{taxesDue.length} {t.finances.records}</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t.finances.stats.purchasesDue}</span>
          <strong className="stat-value">{money(purchasesDue.reduce((sum, x) => sum + num(x.total), 0), locale)}</strong>
          <span className="stat-note">{purchasesDue.length} {t.finances.records}</span>
        </article>
      </div>

      <div className="fin-section">
        <h3 className="fin-heading">{t.finances.monthly.title}</h3>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>{t.finances.monthly.period}</th>
                <th className="num">{t.finances.monthly.netSales}</th>
                <th className="num">{t.finances.monthly.shipping}</th>
                <th className="num">{t.finances.monthly.cogs}</th>
                <th className="num">{t.finances.monthly.grossProfit}</th>
                <th className="num">{t.finances.monthly.opex}</th>
                <th className="num">{t.finances.monthly.payroll}</th>
                <th className="num">{t.finances.monthly.taxes}</th>
                <th className="num">{t.finances.monthly.netProfit}</th>
                <th className="num">{t.finances.monthly.inventory}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const inProgress = num(m.grossSales) === 0 && num(m.operatingExpenses) === 0
                return (
                  <tr key={m.id} className={inProgress ? 'fin-row-muted' : ''}>
                    <td className="nowrap">
                      {monthLabel(m.periodStart, locale)}
                      {inProgress ? <span className="fin-tag">{t.finances.monthly.inProgress}</span> : ''}
                    </td>
                    <td className="num">{money(m.netSales, locale)}</td>
                    <td className="num">{money(m.shippingRevenue, locale)}</td>
                    <td className="num">{money(m.costOfGoods, locale)}</td>
                    <td className="num">{money(m.grossProfit, locale)}</td>
                    <td className="num">{money(m.operatingExpenses, locale)}</td>
                    <td className="num">{money(m.payroll, locale)}</td>
                    <td className="num">{money(m.taxes, locale)}</td>
                    <td className={`num${num(m.netProfit) < 0 ? ' is-negative' : ' is-positive'}`}>{money(m.netProfit, locale)}</td>
                    <td className="num">{money(m.inventoryPurchases, locale)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="fin-columns">
        <div className="fin-section" style={{ backgroundColor: 'rgba(104, 199, 183, 0.34)', padding: '26px', borderRadius: '8px' }}>
          <h3 className="fin-heading">{t.finances.expenses.byCategory}</h3>
          <RankedList items={categories} max={maxCategory} accent="fin-accent-mango" />
        </div>

        <div className="fin-section" style={{ backgroundColor: 'rgba(140, 215, 184, 0.34)', padding: '26px', borderRadius: '8px' }}>
          <h3 className="fin-heading">{t.finances.purchases.totalsTitle}</h3>
          <RankedList items={suppliers} max={maxSupplier} accent="fin-accent-aqua" />
        </div>
      </div>

      <div className="fin-section">
        <h3 className="fin-heading">{t.finances.expenses.recent}</h3>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>{t.finances.expenses.date}</th>
                <th>{t.finances.expenses.category}</th>
                <th>{t.finances.expenses.description}</th>
                <th>{t.finances.expenses.method}</th>
                <th className="num">{t.finances.expenses.amount}</th>
              </tr>
            </thead>
            <tbody>
              {(finances.expenses?.items || []).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{dayLabel(e.date, locale)}</td>
                  <td><span className="fin-chip">{t.finances.categories[e.category] || e.category}</span></td>
                  <td>{e.description}</td>
                  <td>{t.finances.methods[e.paymentMethod] || e.paymentMethod || '—'}</td>
                  <td className="num">{money(e.amount, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination t={t} section={finances.expenses} loading={loading} onPage={goTo('expenses')} />
        </div>
      </div>

      <div className="fin-section">
        <h3 className="fin-heading">{t.finances.payroll.title}</h3>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>{t.finances.payroll.period}</th>
                <th>{t.finances.payroll.employee}</th>
                <th>{t.finances.payroll.position}</th>
                <th className="num">{t.finances.payroll.gross}</th>
                <th className="num">{t.finances.payroll.deductions}</th>
                <th className="num">{t.finances.payroll.net}</th>
                <th>{t.finances.payroll.paid}</th>
                <th>{t.finances.payroll.status}</th>
              </tr>
            </thead>
            <tbody>
              {(finances.payroll?.items || []).map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{dayLabel(p.periodStart, locale)} – {dayLabel(p.periodEnd, locale)}</td>
                  <td>{p.employee}</td>
                  <td>{p.position}</td>
                  <td className="num">{money(p.gross, locale)}</td>
                  <td className="num">{money(p.deductions, locale)}</td>
                  <td className="num">{money(p.net, locale)}</td>
                  <td className="nowrap">{dayLabel(p.paymentDate, locale)}</td>
                  <td><StatusPill status={p.status} statuses={t.finances.statuses} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination t={t} section={finances.payroll} loading={loading} onPage={goTo('payroll')} />
        </div>
      </div>

      <div className="fin-section">
        <h3 className="fin-heading">{t.finances.taxes.title}</h3>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>{t.finances.taxes.name}</th>
                <th>{t.finances.taxes.period}</th>
                <th className="num">{t.finances.taxes.amount}</th>
                <th>{t.finances.taxes.due}</th>
                <th>{t.finances.taxes.paid}</th>
                <th>{t.finances.taxes.status}</th>
              </tr>
            </thead>
            <tbody>
              {(finances.taxes?.items || []).map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="nowrap">{monthLabel(x.periodStart, locale)}</td>
                  <td className="num">{money(x.amount, locale)}</td>
                  <td className="nowrap">{dayLabel(x.dueDate, locale)}</td>
                  <td className="nowrap">{dayLabel(x.paymentDate, locale)}</td>
                  <td><StatusPill status={x.status} statuses={t.finances.statuses} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination t={t} section={finances.taxes} loading={loading} onPage={goTo('taxes')} />
        </div>
      </div>

      <div className="fin-section">
        <h3 className="fin-heading">{t.finances.purchases.title}</h3>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>{t.finances.purchases.date}</th>
                <th>{t.finances.purchases.supplier}</th>
                <th>{t.finances.purchases.invoice}</th>
                <th className="num">{t.finances.purchases.total}</th>
                <th>{t.finances.purchases.method}</th>
                <th>{t.finances.purchases.status}</th>
              </tr>
            </thead>
            <tbody>
              {(finances.purchases?.items || []).map((x) => (
                <tr key={x.id}>
                  <td className="nowrap">{dayLabel(x.date, locale)}</td>
                  <td>{x.supplier}</td>
                  <td>{x.invoice || '—'}</td>
                  <td className="num">{money(x.total, locale)}</td>
                  <td>{t.finances.methods[x.paymentMethod] || x.paymentMethod || '—'}</td>
                  <td><StatusPill status={x.status} statuses={t.finances.statuses} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination t={t} section={finances.purchases} loading={loading} onPage={goTo('purchases')} />
        </div>
      </div>
    </section>
  )
}
