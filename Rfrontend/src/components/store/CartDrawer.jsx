import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Banknote, ChevronDown, Landmark, LockKeyhole, PawPrint, Tag, Trash2, X } from 'lucide-react'

import TermsGate from './TermsGate.jsx'

export default function CartDrawer({ open, onClose, cart, setCart, zones, customer, onOpenAccount, blocked, promo, setPromo, promoEligible = true, termsAccepted = false, onTermsAccept, onSubmit, success, error, loadingOrder, prefersReducedMotion, t, formatMoney }) {
  const [checkout, setCheckout] = useState({ firstName: '', lastName: '', email: '', phone: '', zoneId: '', neighborhood: '', reference: '', paymentMethod: '', petName: '', petSize: '' })
  const [termsOpen, setTermsOpen] = useState(false)
  const pendingForm = useRef(null)

  const petbox = cart.find((line) => line.isPetbox)
  const subtotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0)
  const zone = zones.find((item) => String(item.id) === checkout.zoneId)
  const discount = promo && promoEligible ? Math.round(subtotal * 10) / 100 : 0
  const count = cart.reduce((sum, line) => sum + line.quantity, 0)

  function change(id, amount) {
    setCart((lines) => lines.flatMap((line) => {
      if (line.id !== id) return [line]
      if (line.isPetbox || line.quantity + amount < 1) return []
      return [{ ...line, quantity: Math.min(line.stock, line.quantity + amount) }]
    }))
  }

  function remove(id) {
    setCart((lines) => lines.filter((line) => line.id !== id))
  }

  function update(field, value) {
    setCheckout((current) => ({ ...current, [field]: value }))
    if (field === 'petName') setCart((lines) => lines.map((line) => line.isPetbox ? { ...line, petName: value.trim() || null } : line))
  }

  async function doSubmit() {
    await onSubmit({ ...checkout, promoCode: promo && promoEligible ? 'PETNICA10' : null, termsAccepted: true }, pendingForm.current)
  }

  async function submit(event) {
    event.preventDefault()
    pendingForm.current = event.currentTarget
    if (!termsAccepted) {
      setTermsOpen(true)
      return
    }
    await doSubmit()
  }

  async function acceptTerms(remember) {
    setTermsOpen(false)
    onTermsAccept?.(remember)
    await doSubmit()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="veil on"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            id="cart"
            className="on"
            aria-label={t.cart.title}
            aria-modal={!blocked}
            role="dialog"
            inert={blocked}
            initial={{ x: prefersReducedMotion ? 0 : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: prefersReducedMotion ? 0 : '100%' }}
            transition={{ type: 'spring', stiffness: 330, damping: 32 }}
          >
            <div className="cart-head">
              <div>
                <span className="eyebrow">{t.cart.eyebrow}</span>
                <h2>{t.cart.title} <span>{count ? `(${count})` : ''}</span></h2>
              </div>
              <button className="close-btn" type="button" aria-label={t.cart.close} onClick={onClose}>
                <X size={20} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>

            {!cart.length && !success && (
              <div className="cart-empty-state">
                <span className="empty-paw"><PawPrint size={30} strokeWidth={1.6} aria-hidden="true" /></span>
                <b>{t.cart.emptyTitle}</b>
                <p className="sub">{t.cart.empty}</p>
                <button className="btn" type="button" onClick={onClose}>{t.cart.keepShopping}</button>
              </div>
            )}

            {success && (
              <div className="order-success" role="status">
                <b>{t.cart.success.replace('{id}', success.orderId)}</b>
                <span>{t.cart.orderTotal.replace('{total}', formatMoney(success.total))} {success.whatsapp ? t.cart.confirmWhatsapp : t.cart.contactSoon}</span>
                {success.whatsapp && (
                  <a href={success.whatsapp} target="_blank" rel="noopener noreferrer">
                    {t.cart.whatsapp} <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                )}
                <button className="btn" type="button" onClick={onClose}>{t.cart.keepShopping}</button>
              </div>
            )}

            {Boolean(cart.length) && (
              <div id="items">
                {cart.map((line) => (
                  <div className="line" key={line.id}>
                    <div className="line-info">
                      <b>{line.name}</b>
                      <small>{line.presentation || (line.isPetbox ? t.cart.subscription : '')}</small>
                      {!line.isPetbox && (
                        <div className="qty">
                          <button
                            className={line.quantity === 1 ? 'qty-remove' : 'qty-decrease'}
                            type="button"
                            aria-label={`${line.quantity === 1 ? t.cart.remove : t.cart.decrease} ${line.name}`}
                            onClick={() => change(line.id, -1)}
                          >
                            {line.quantity === 1 ? <Trash2 size={12} strokeWidth={1.9} aria-hidden="true" /> : '−'}
                          </button>
                          <span>{line.quantity}</span>
                          <button
                            className="qty-increase"
                            type="button"
                            aria-label={`${t.cart.increase} ${line.name}`}
                            onClick={() => change(line.id, 1)}
                            disabled={line.quantity >= line.stock}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="line-side">
                      <b>{formatMoney(line.price * line.quantity)}</b>
                      <button className="line-remove" type="button" aria-label={`${t.cart.remove} ${line.name}`} onClick={() => remove(line.id)}>
                        <X size={13} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {Boolean(cart.length) && (
              <form id="checkout" onSubmit={submit}>
                <div className="form-section">
                  <h3>{t.cart.yourData}</h3>

                  <div className="form-grid">
                    <label>{t.cart.firstName}<input
                      name="firstName"
                      autoComplete="given-name"
                      maxLength="80"
                      value={customer?.firstName ?? checkout.firstName}
                      onChange={(e) => update('firstName', e.target.value)}
                      readOnly={Boolean(customer)} required />
                    </label>
                    <label>{t.cart.lastName}<input
                      name="lastName"
                      autoComplete="family-name"
                      maxLength="80"
                      value={customer?.lastName ?? checkout.lastName}
                      onChange={(e) => update('lastName', e.target.value)}
                      readOnly={Boolean(customer)} required />
                    </label>
                  </div>

                  <label>{t.cart.email}<input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength="150"
                    value={customer?.email ?? checkout.email}
                    onChange={(e) => update('email', e.target.value)}
                    readOnly={Boolean(customer)}
                    required />
                  </label>

                  <label>{t.cart.phone}<input
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    maxLength="20"
                    placeholder="+505 8888 0000"
                    value={customer?.phone ?? checkout.phone}
                    onChange={(e) => update('phone', e.target.value)} />
                  </label>
                </div>

                <div className="form-section">
                  <h3>{t.cart.checkoutTitle}</h3>

                  <label>{t.cart.zone}<span className="select-wrap"><select
                    name="zoneId"
                    value={checkout.zoneId}
                    onChange={(e) => update('zoneId', e.target.value)} required>
                      <option value="">{zones.length ? t.cart.chooseDistrict : t.cart.loadingZones}</option>
                      {zones.map((item) => (
                        <option key={item.id} value={item.id}>{item.district} · {formatMoney(item.fee)} · {item.days} {t.cart.days}</option>
                      ))}
                    </select><ChevronDown size={15} strokeWidth={2} aria-hidden="true" /></span>
                  </label>
                  <label>{t.cart.neighborhood}<input name="neighborhood" autoComplete="address-level3" maxLength="100" value={checkout.neighborhood} onChange={(e) => update('neighborhood', e.target.value)} required /></label>
                  <label>{t.cart.reference}<textarea name="reference" rows="2" maxLength="2000" placeholder={t.cart.referencePlaceholder} value={checkout.reference} onChange={(e) => update('reference', e.target.value)} required /></label>

                  {petbox && (
                    <div id="petFields">
                      <h3>{t.cart.petDetails}</h3>
                      <label>{t.cart.petName}<input name="petName" maxLength="80" value={checkout.petName} onChange={(e) => update('petName', e.target.value)} required /></label>
                      {petbox.species === 'perro' && (
                        <label>{t.cart.petSize}<span className="select-wrap"><select name="petSize" value={checkout.petSize || petbox.size || ''} onChange={(e) => update('petSize', e.target.value)} required>
                          <option value="">{t.cart.chooseSize}</option>
                          {t.cart.petSizes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select><ChevronDown size={15} strokeWidth={2} aria-hidden="true" /></span></label>
                      )}
                    </div>
                  )}
                </div>

                <div className="form-section">
                  <h3>{t.cart.payment}</h3>

                  <div className="pay-methods">
                    <label className="pay-method">
                      <input type="radio" name="paymentMethod" value="efectivo_contra_entrega" required checked={checkout.paymentMethod === 'efectivo_contra_entrega'} onChange={(e) => update('paymentMethod', e.target.value)} />
                      <span className="pay-icon">
                        <Banknote size={17} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <span className="pay-text"><b>{t.cart.cash}</b>
                        <small>{t.cart.cashHint}</small>
                      </span>
                    </label>
                    <label className="pay-method">
                      <input type="radio" name="paymentMethod" value="transferencia" required checked={checkout.paymentMethod === 'transferencia'} onChange={(e) => update('paymentMethod', e.target.value)} />
                      <span className="pay-icon">
                        <Landmark size={17} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <span className="pay-text"><b>{t.cart.transfer}</b>
                        <small>{t.cart.transferHint}</small>
                      </span>
                    </label>
                  </div>

                  {promoEligible && (
                    <label className="promo-check"><Tag size={14} strokeWidth={1.9} aria-hidden="true" />
                      <input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} />
                      <span className="promo-text">{t.cart.promoCheck} <b>PETNICA10</b> {t.cart.firstOrder}</span>
                    </label>
                  )}
                </div>

                <div className="checkout-foot">
                  <div className="sum">
                    <div>
                      <span>{t.cart.subtotal}</span><span>{formatMoney(subtotal)}</span>
                    </div>
                    {promo && promoEligible && (
                      <div>
                        <span>{t.cart.promoEstimate}</span>
                        <span>− {formatMoney(discount)}</span>
                      </div>
                    )}
                    <div>
                      <span>{t.cart.shipping} {zone ? '' : t.cart.confirmShipping}</span>
                      <span>{zone ? formatMoney(zone.fee) : '—'}</span>
                    </div>
                    <div>
                      <b>{t.cart.total} {zone ? '' : t.cart.estimated}</b>
                      <b>{formatMoney(subtotal - discount + (Number(zone?.fee) || 0))}</b>
                    </div>
                  </div>

                  <p className="shipping-note">{t.cart.shippingNote}</p>

                  {!customer && (
                    <p className="checkout-account-note">
                      {t.cart.accountRequired}
                      <button className="text-button" type="button" onClick={onOpenAccount}>{t.cart.accountButton}</button>
                    </p>
                  )}

                  {error && <p className="checkout-error" role="alert">{error}</p>}

                  <button className="btn submit-btn" type="submit" disabled={!customer || loadingOrder}>
                    {loadingOrder ? t.cart.registering : t.cart.submit}
                  </button>
                  <p className="secure-note"><LockKeyhole size={12} strokeWidth={2} aria-hidden="true" /> {t.cart.secureCheckout}</p>
                </div>
              </form>
            )}
          </motion.aside>

          <TermsGate
            open={termsOpen}
            onCancel={() => setTermsOpen(false)}
            onAccept={acceptTerms}
            prefersReducedMotion={prefersReducedMotion}
            t={t}
          />
        </>
      )}
    </AnimatePresence>
  )
}
