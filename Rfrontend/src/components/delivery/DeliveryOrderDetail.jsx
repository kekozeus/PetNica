import { useState } from 'react'
import { ArrowLeft, CheckCircle2, MessageCircle, Truck } from 'lucide-react'

import VideoRecorder from './VideoRecorder.jsx'
import SignaturePad from './SignaturePad.jsx'

export default function DeliveryOrderDetail({ t, order, request, formatMoney, formatDate, onBack, onUpdated }) {
  const [recipient, setRecipient] = useState('')
  const [video, setVideo] = useState(null)
  const [signature, setSignature] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const isTransfer = order.paymentMethod === 'transferencia'
  const whatsapp = order.phone ? `https://wa.me/${String(order.phone).replace(/\D/g, '')}?text=${encodeURIComponent(t.messages.whatsapp.replace('{name}', order.firstName).replace('{id}', order.id))}` : ''

  async function markEnCamino() {
    setBusy(true)
    setError('')
    try {
      await request(`/api/delivery/orders/${order.id}/status`, { method: 'PUT', body: { status: 'en_camino' } })
      onUpdated({ ...order, status: 'en_camino', claimedByMe: true }, t.messages.statusUpdated)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelivery() {
    if (!video) return setError(t.video.required)
    if (!signature) return setError(t.signature.required)
    if (!recipient.trim()) return setError(t.detail.recipientName)
    setBusy(true)
    setError('')
    try {
      await request(`/api/delivery/orders/${order.id}/proof`, {
        method: 'POST',
        body: {
          videoPath: video.path,
          videoUrl: video.url,
          recipientName: recipient,
          signatureData: signature,
        },
      })
      setDone(true)
      onUpdated(null, t.messages.delivered)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button className="button outline small detail-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} strokeWidth={2.4} aria-hidden="true" /> {t.detail.back}
      </button>

      {done ? (
        <div className="detail-card">
          <p className="message"><CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> {t.detail.deliveredBanner}</p>
          <div style={{ marginTop: 14 }}>
            <button className="button primary" type="button" onClick={onBack}>{t.detail.back}</button>
          </div>
        </div>
      ) : (
        <div className="detail-grid">
          <div className="detail-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <h2>{t.detail.order} #{order.id}</h2>
              <span className={`status-pill status-${order.status}`}>{t.states[order.status] || order.status}</span>
            </div>
            {order.createdAt && <p className="muted" style={{ marginTop: -6 }}>{formatDate(order.createdAt)}</p>}

            <div className="detail-rows">
              <div className="row"><span>{t.detail.customer}</span><span>{order.firstName} {order.lastName}</span></div>
              <div className="row"><span>{t.detail.address}</span><span>{order.shippingAddress}</span></div>
              <div className="row">
                <span>{t.detail.phone}</span>
                <span>
                  {order.phone ? (
                    <a href={whatsapp} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--aqua-strong)', fontWeight: 900, textDecoration: 'none' }}>
                      <MessageCircle size={13} strokeWidth={2.2} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {order.phone}
                    </a>
                  ) : t.detail.noPhone}
                </span>
              </div>
            </div>

            <h3 style={{ marginTop: 18 }}>{t.detail.items}</h3>
            <ul className="detail-items">
              {order.items.map((item, index) => (
                <li key={index}>
                  <span><span className="qty">{item.quantity}×</span> {item.name}</span>
                  <span className="price">{formatMoney(item.unitPrice * item.quantity)}</span>
                </li>
              ))}
              {order.petboxName && (
                <li><span><span className="qty">1×</span> {order.petboxName}</span><span className="price">{formatMoney(Number(order.subtotal) - order.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0))}</span></li>
              )}
            </ul>

            <div className="detail-rows" style={{ marginTop: 14 }}>
              <div className="row"><span>{t.detail.subtotal}</span><span>{formatMoney(order.subtotal)}</span></div>
              {Number(order.discount) > 0 && <div className="row"><span>{t.detail.discount}</span><span>− {formatMoney(order.discount)}</span></div>}
              <div className="row"><span>{t.detail.shipping}</span><span>{formatMoney(order.shipping)}</span></div>
              <div className="row"><span>{t.detail.total}</span><span>{formatMoney(order.total)}</span></div>
            </div>

            <p className="detail-payment">
              {isTransfer ? t.detail.transferNote.replace('{status}', t.states[order.paymentStatus] || order.paymentStatus) : t.detail.cashNote}
            </p>
            {order.notes && <p className="detail-note">{order.notes}</p>}
          </div>

          <div className="detail-actions">
            {order.claimedByOther ? (
              <p className="message error">{t.detail.claimedWarning}</p>
            ) : (
              <>
                {order.status !== 'en_camino' && (
                  <button className="button primary block" type="button" onClick={markEnCamino} disabled={busy}>
                    <Truck size={16} strokeWidth={2} aria-hidden="true" /> {t.detail.markEnCamino}
                  </button>
                )}
                {order.status === 'en_camino' && order.claimedByMe && (
                  <p className="help-text">{t.detail.enCaminoMarked}</p>
                )}

                <div className="proof-card">
                  <div>
                    <h3 style={{ marginBottom: 4 }}>{t.detail.proofTitle}</h3>
                    <p className="video-help">{t.detail.proofHelp}</p>
                  </div>

                  <label>{t.detail.recipientName}
                    <input
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      placeholder={t.detail.recipientPlaceholder}
                      maxLength="160"
                    />
                  </label>

                  <VideoRecorder t={t} orderId={order.id} request={request} onUploaded={setVideo} />
                  <SignaturePad t={t} onChange={setSignature} />

                  {error && <p className="message error" role="alert">{error}</p>}

                  <button
                    className="button primary block"
                    type="button"
                    onClick={confirmDelivery}
                    disabled={busy || !video || !signature || !recipient.trim()}
                  >
                    {busy ? t.detail.delivering : t.detail.confirmDelivery}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
