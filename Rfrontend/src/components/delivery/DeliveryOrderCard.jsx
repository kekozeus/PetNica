import { ChevronRight } from 'lucide-react'

export default function DeliveryOrderCard({ t, order, onOpen, formatMoney, formatDate }) {
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0)
  return (
    <button className="order-card" type="button" onClick={() => onOpen(order)}>
      <span className="order-card-head">
        <span>
          <h3>{t.orders.order} #{order.id}</h3>
          <span className="order-card-customer">{order.firstName} {order.lastName}</span>
        </span>
        <span style={{ display: 'grid', gap: 5, justifyItems: 'end' }}>
          <time dateTime={order.createdAt}>{formatDate(order.createdAt)}</time>
          <span className={`status-pill status-${order.status}`}>{t.states[order.status] || order.status}</span>
          {order.claimedByMe && <span className="status-pill mine-pill">{t.orders.claimed}</span>}
          {order.claimedByOther && <span className="status-pill claim-pill">{t.orders.claimedByOther}</span>}
        </span>
      </span>

      <span className="order-card-meta">
        <span className="muted">{itemCount} {t.orders.items}</span>
        <span className="earn">{t.orders.youEarn}: {formatMoney(order.shipping)}</span>
        <span className="muted">{order.paymentMethod === 'transferencia' ? t.orders.transfer : t.orders.cash}</span>
      </span>

      <span className="order-card-foot">
        <span>{order.shippingAddress}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none' }}>
          {t.orders.viewOrder} <ChevronRight size={14} strokeWidth={2.4} aria-hidden="true" />
        </span>
      </span>
    </button>
  )
}
