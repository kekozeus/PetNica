import { Search } from 'lucide-react'

import OrderCard from './OrderCard.jsx'

export default function OrdersPanel({ t, overview, filteredOrders, orderQuery, onOrderQuery, orderStatusFilter, onStatusFilter, orderStatuses, paymentStatuses, onChangeOrder, request, locale }) {
  return (
    <section className="tab-panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">{t.orders.eyebrow}</span>
          <h2>{t.orders.title}</h2>
        </div>
        <span className="count-pill">{overview.orders.length}</span>
      </div>

      <p className="help-text">{t.orders.help}</p>

      <div className="admin-list-toolbar order-toolbar">
        <label className="admin-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={orderQuery}
            onChange={(event) => onOrderQuery(event.target.value)}
            placeholder={t.orders.searchPlaceholder}
            aria-label={t.orders.search}
          />
        </label>
        <label className="admin-status-filter">
          <span>{t.orders.status}</span>
          <select value={orderStatusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
            <option value="all">{t.orders.allStatuses}</option>
            {Object.entries(orderStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </label>
        <span className="admin-result-count">{filteredOrders.length} / {overview.orders.length}</span>
      </div>

      <div className="order-list">
        {filteredOrders.length ? filteredOrders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            t={t}
            orderStatuses={orderStatuses}
            paymentStatuses={paymentStatuses}
            onChange={onChangeOrder}
            request={request}
            locale={locale}
          />
        )) : overview.orders.length ? (
          <p className="empty">{t.orders.noSearchResults}</p>
        ) : (
          <p className="empty">{t.orders.empty}</p>
        )}
      </div>
    </section>
  )
}
