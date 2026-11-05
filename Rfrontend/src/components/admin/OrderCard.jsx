import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { imageUrl, money } from '../../lib/api.js'
import Field from './Field.jsx'
import StatusSelect from './StatusSelect.jsx'

const dateTime = (value, locale) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

function DeliveryProof({ order, t, orderStatuses, request, locale }) {
  const [proof, setProof] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    request(`/api/admin/orders/${order.id}/delivery`)
      .then((result) => { if (mounted) setProof(result.delivery) })
      .catch((err) => { if (mounted) setError(err.message) })
    return () => { mounted = false }
  }, [order.id, request])

  const summary = order.delivery
  const videoUrl = proof ? imageUrl(proof.videoUrl) : ''

  return (
    <div className="delivery-proof">
      <h4>{t.orders.deliveryProof}</h4>
      <div className="delivery-proof-meta">
        <div><span>{t.orders.courier}</span> {summary.courierEmail}</div>
        <div><span>{t.orders.status}</span> {orderStatuses[summary.status] || summary.status}</div>
        {summary.recipientName && <div><span>{t.orders.receivedBy}</span> {summary.recipientName}</div>}
        {summary.deliveredAt && <div><span>{t.orders.deliveredAt}</span> {dateTime(summary.deliveredAt, locale)}</div>}
      </div>
      {error ? (
        <p className="delivery-proof-note">{error}</p>
      ) : !proof ? (
        <p className="delivery-proof-note">{t.orders.proofLoading}</p>
      ) : (
        <div className="delivery-proof-media">
          {videoUrl && (
            <figure>
              <figcaption>{t.orders.video}</figcaption>
              <video src={videoUrl} controls preload="metadata" playsInline />
            </figure>
          )}
          {proof.signatureData && (
            <figure>
              <figcaption>{t.orders.signature}</figcaption>
              <img src={proof.signatureData} alt={t.orders.signature} />
            </figure>
          )}
        </div>
      )}
    </div>
  )
}

export default function OrderCard({ order, t, orderStatuses, paymentStatuses, onChange, request, locale }) {
  const [open, setOpen] = useState(false)

  return (
    <details className="order-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="order-summary">
        <span className="order-summary-main">
          <strong>{t.orders.order} #{order.id}</strong>
          <small>{order.firstName} {order.lastName} · {order.email}</small>
        </span>
        <span className={`order-status-pill status-${order.status}`}>
          {orderStatuses[order.status] || order.status}
        </span>
        {order.paymentMethod === 'transferencia' && (
          <span className={`payment-status-pill payment-${order.paymentStatus || 'pendiente'}`}>
            {t.orders.paymentShort}: {paymentStatuses[order.paymentStatus] || t.states.pending}
          </span>
        )}
        <span className="order-summary-total">
          <time>{dateTime(order.createdAt, locale)}</time>
          <b>{money(order.total, locale)}</b>
        </span>
        <span className="order-summary-toggle">{t.orders.details}<ChevronDown size={16} aria-hidden="true" /></span>
      </summary>

      <div className="order-details">
        <div className="order-info">
          <div><span>{t.orders.whatsapp}</span> {order.phone}</div>
          <div><span>{t.orders.breakdown}</span> {money(order.subtotal, locale)} − {money(order.discount, locale)} + {money(order.shipping, locale)}</div>
          <div><span>{t.orders.delivery}</span> {order.shippingAddress}</div>
          <div><span>{t.orders.paymentMethod}</span> {order.paymentMethod === 'transferencia' ? t.orders.paymentTransfer : t.orders.cash}</div>
        </div>

        <ul className="order-items">
          {order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name} · {money(item.unitPrice, locale)}</li>)}
          {order.petboxName && <li>1 × {order.petboxName}</li>}
        </ul>

        {open && order.delivery && (
          <DeliveryProof
            order={order}
            t={t}
            orderStatuses={orderStatuses}
            request={request}
            locale={locale}
          />
        )}

        <div className="order-actions">
          <Field label={t.orders.status}>
            <StatusSelect
              className="order-status"
              name="status"
              values={orderStatuses}
              value={order.status}
              onChange={(event) => onChange(order, 'status', event.target.value)}
            />
          </Field>
          {order.paymentMethod === 'transferencia' ? (
            <Field label={t.orders.paymentStatus}>
              <StatusSelect
                className="payment-status"
                name="paymentStatus"
                values={paymentStatuses}
                value={order.paymentStatus}
                onChange={(event) => onChange(order, 'payment', event.target.value)}
              />
            </Field>
          ) : (
            <span className="order-meta">{t.orders.cash}</span>
          )}
          <a
            className="button outline small"
            href={`https://wa.me/${String(order.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(t.messages.contactMessage.replace('{name}', order.firstName).replace('{id}', order.id))}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.orders.contact}
          </a>
        </div>
      </div>
    </details>
  )
}
