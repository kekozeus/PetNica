import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, ArrowUpRight, Heart, HeartHandshake, LockKeyhole, MessageCircle, PawPrint, Sparkles, Star, Truck, X } from 'lucide-react'
import brandIcon from '../../assets/icon.png'
import snoopyDog from '../../assets/SittingSnoppy.png'
import garfieldCat from '../../assets/Garfield.png'
import { apiRequest, imageUrl, money } from '../../lib/api.js'
import { useLanguage } from '../../lib/useLanguage.js'
import { storeTranslations } from './store.js'
import './store.css'

const speciesImages = { perro: snoopyDog, gato: garfieldCat }
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const readCart = () => {
  try {
    const value = JSON.parse(localStorage.getItem('petnica.cart') || '[]')
    const items = Array.isArray(value) ? value : value?.items
    return { items: Array.isArray(items) ? items.filter((line) => line && (line.isPetbox && typeof line.planId === 'string' || typeof line.variantId === 'string' && Number.isInteger(line.quantity) && line.quantity > 0)) : [], owner: Array.isArray(value) ? null : value?.owner || null, pending: !Array.isArray(value) && Boolean(value?.pending) }
  } catch {
    return { items: [], owner: null, pending: false }
  }
}
const savedCart = readCart()

function Stars({ rating = 0, label }) {
  const filled = Math.round(Math.max(0, Math.min(5, Number(rating) || 0)))
  return <span className="stars" role="img" aria-label={label || `${Number(rating).toFixed(1)} out of 5 stars`}>{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={16} strokeWidth={1.8} className={star <= filled ? 'filled' : ''} fill={star <= filled ? 'currentColor' : 'none'} aria-hidden="true" />)}</span>
}

function ReviewList({ items, empty, t, locale }) {
  return items?.length ? <div className="review-list">{items.map((review, index) => 
    <article className="review-card" key={`${review.createdAt}-${index}`}>
      <div className="review-card-head">
        <div>
          <Stars rating={review.rating} label={`${Number(review.rating).toFixed(1)} ${t.detail.rating}`} />
          <b>{review.customerName}</b>
        </div>
        <time>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(review.createdAt))}</time>
      </div>
      <p>{review.comment || t.detail.noComment}</p>
    </article>
  )}</div> : <p className="reviews-empty">{empty}</p>
}

function AccountDialog({ open, onClose, customer, csrf, setCsrf, onAuth, onLogout, googleConfigured, error, setError, loadOrders, orders, onInvoice, prefersReducedMotion, t, locale, formatMoney }) {
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open && customer) loadOrders() }, [open, customer, loadOrders])
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
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  return <AnimatePresence>
    {open && 
    <motion.div 
      className="modal-backdrop account-backdrop" 
      role="presentation" 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <motion.section 
        className="account-dialog" 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="accountTitle" 
        initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 18, scale: .98 }} 
        animate={{ opacity: 1, y: 0, scale: 1 }} 
        exit={{ opacity: 0, y: prefersReducedMotion ? 0 : 12, scale: .98 }} 
        transition={{ duration: prefersReducedMotion ? 0 : .22 }}>

        <div className="account-head">
          <div>
            <span className="eyebrow">{t.account.eyebrow}</span>
            <h2 id="accountTitle">{t.account.title}</h2>
          </div>
          <button className="close-btn" type="button" aria-label={t.account.close} onClick={onClose}><X size={20} strokeWidth={1.8} aria-hidden="true" /></button>
        </div>
        {customer ? <>
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
          {orders === null ? 
          <p className="empty">{t.account.loadingOrders}</p> : orders.length ? orders.map((order) => 
          <article className="customer-order" key={order.id}>
            <div className="customer-order-top">
              <b>{t.cart.title} #{order.id} · {formatMoney(order.total)}</b>
              <time>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(order.createdAt))}</time>
            </div>
            <ul>
              {order.items.map((item, i) => <li key={i}>{item.quantity} × {item.name} · {formatMoney(Number(item.unitPrice) * Number(item.quantity))}</li>)}
              {order.petboxName && <li>1 × {order.petboxName}</li>}
            </ul>
            <small>{order.shippingAddress}</small>
            <div className="customer-order-bottom">
              <span className="status-label">{t.order.status[order.status] || order.status}</span>
              <button className="invoice-button" type="button" onClick={() => onInvoice(order)}>{t.account.invoice}</button>
            </div>
          </article>) : <p className="empty">
            {t.account.noOrders}
          </p>}
        </div>
        </> : <>
          <p className="sub">{t.account.loginIntro}</p>
            <div className="auth-switch" role="group" aria-label={t.account.accessMode}>
              <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError('') }}>
                {t.account.login}
              </button>
              <button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError('') }}>
                {t.account.register}
              </button>
            </div>
          {googleConfigured && <>
            <a className="google-button" href="/api/account/google"><span>G</span> {t.account.google}</a>
            <div className="auth-divider"><span>{t.account.orEmail}</span></div>
          </>}
          {mode === 'login' ? 
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
            </section> : 
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
          }
          {error && <p className="account-error" role="alert">{error}</p>}
          <p className="account-note">
            {t.account.secureNote}
          </p>
        </>}
      </motion.section>
    </motion.div>}
  </AnimatePresence>
}

function ProductDialog({ details, onClose, onAdd, onReviewSubmitted, customer, csrf, onLogin, prefersReducedMotion, t, locale, formatMoney }) {
  const [variantId, setVariantId] = useState('')
  const [productRating, setProductRating] = useState(0)
  const [deliveryRating, setDeliveryRating] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const product = details?.product
  const variants = product?.variants || []
  const selectedVariantId = variantId || String(variants[0]?.id || '')
  const variant = variants.find((item) => String(item.id) === selectedVariantId) || variants[0]
  const eligible = details?.eligibleOrders || []
  const [orderId, setOrderId] = useState('')
  const selectedOrderId = orderId || String(eligible[0]?.id || '')
  const selectedOrder = eligible.find((order) => String(order.id) === selectedOrderId)
  async function submitReview(event) {
    event.preventDefault()
    if (!productRating) return setError(t.detail.reviewError)
    setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      await apiRequest('/api/account/reviews', { 
        method: 'POST', 
        body: { 
          productId: product.id, 
          orderId: selectedOrderId, 
          productRating, 
          productComment: data.get('productComment'), 
          deliveryRating: selectedOrder?.deliveryReviewed ? null : deliveryRating, 
          deliveryComment: selectedOrder?.deliveryReviewed ? null : data.get('deliveryComment') 
        } 
      }, csrf)
      await onReviewSubmitted()
      setOrderId('')
      setProductRating(0)
      setDeliveryRating(0)
    } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }
  return <AnimatePresence>
    {details && 
    <motion.div 
      className="modal-backdrop product-backdrop" 
      role="presentation" 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      onMouseDown={(event) => {   
      if (event.target === event.currentTarget) {
        onClose()
      }
    }}>
      <motion.section 
        className="product-dialog" 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="productDialogTitle" 
        initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : .97, y: prefersReducedMotion ? 0 : 15 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : .98 }} 
        transition={{ duration: prefersReducedMotion ? 0 : .2 }}>
        <div className="product-dialog-head">
          <span className="eyebrow">{t.detail.eyebrow}</span>
            <button className="close-btn" type="button" aria-label={t.detail.close} onClick={() => onClose()}><X size={20} strokeWidth={1.8} aria-hidden="true" /></button>
        </div>
        {!product ? <p className={details.error ? 'account-error' : 'empty'} role={details.error ? 'alert' : undefined}>{details.error || t.detail.loading}</p> : <>
          <div className="detail-layout">
            <div className="detail-gallery">
              <div className="detail-image">{imageUrl(product.image) ? 
                <img src={imageUrl(product.image)} alt={product.name} /> : 
                  <PawPrint className="empty-product-icon" size={58} strokeWidth={1.35} aria-hidden="true" />}
                </div>
                <span className="detail-category">{product.category || t.detail.category}</span>
              </div>
             <div className="detail-copy">
              <span className="eyebrow">{t.detail.madeFor}</span>
              <h2 id="productDialogTitle">{product.name}</h2>
              <div className="detail-rating">{product.reviewCount ? <>
                <Stars rating={product.rating} label={`${Number(product.rating).toFixed(1)} ${t.detail.rating}`} /> 
                  <span>{Number(product.rating).toFixed(1)} · {product.reviewCount} {product.reviewCount === 1 ? t.shop.reviewsOne : t.shop.reviewsMany}</span></> : 
                    <span className="no-rating">{t.shop.noRating}</span>}
              </div>
                <p className="detail-description">{product.description || t.detail.fallbackDescription}</p>
                  <label className="detail-variant-label" htmlFor="detailVariant">{t.detail.presentation}</label>
                  <div className="detail-buy-row">
                    <select 
                      id="detailVariant" 
                      value={selectedVariantId} 
                      onChange={(event) => setVariantId(event.target.value)} 
                      hidden={variants.length <= 1}
                    >
                      {variants.map((item) => 
                        <option 
                          key={item.id} 
                          value={item.id} 
                          disabled={Number(item.stock) < 1}
                        >
                          {item.presentation}{Number(item.stock) < 1 ? ' · Agotado' : ''}
                        </option>
                      )}
                    </select>
                    <span className="detail-price">{variant ? formatMoney(variant.price) : t.shop.noStock}</span>
                    <button className="btn" type="button" disabled={!variant || Number(variant.stock) < 1} onClick={() => onAdd(product, variant)}>{!variant || Number(variant.stock) < 1 ? t.shop.outOfStock : t.shop.add}</button>
                  </div>
                  <small className="stock">{variant && Number(variant.stock) > 0 ? `${t.shop.available} · ${variant.stock} ${t.shop.inStock}` : t.shop.noStock}</small>
                </div>
              </div>
          <div className="detail-reviews">
            <section className="review-section">
              <div className="review-section-title">
                <div>
                  <span className="eyebrow">{t.detail.reviewsEyebrow}</span>
                  <h3>{t.detail.productReviews}</h3>
                </div>
                <strong>{product.reviewCount ? `${Number(product.rating).toFixed(1)} / 5` : t.detail.new}</strong>
              </div>
              <ReviewList items={details.reviews} empty={t.detail.emptyReviews} t={t} locale={locale} />
            </section>
            <section className="review-section delivery-reviews">
              <div className="review-section-title">
                <div>
                  <span className="eyebrow">{t.detail.deliveryEyebrow}</span>
                  <h3>{t.detail.delivery}</h3>
                </div>
                <strong>{details.deliveryReviewCount ? `${Number(details.deliveryRating).toFixed(1)} / 5` : '—'}</strong>
              </div>
              <ReviewList items={details.deliveryReviews} empty={t.detail.emptyDelivery} t={t} locale={locale} />
            </section>
          </div>
          <section className="review-write">
            {!customer ? 
              <div className="review-access">
                <LockKeyhole size={24} strokeWidth={1.8} aria-hidden="true" />
                <div>
                  <b>{t.detail.reviewAccessTitle}</b>
                  <p>{t.detail.reviewAccessText}</p>
                </div>
                <button className="btn" type="button" onClick={onLogin}>{t.detail.login}</button>
              </div> : 
              eligible.length ? 
                <form className="review-form" onSubmit={submitReview}>
                  <h3>{t.detail.reviewIntro}</h3>
                  <p className="form-intro">{t.detail.reviewHelp}</p>
                  <label>
                    {t.detail.deliveredOrder}
                    <select name="orderId" value={selectedOrderId} onChange={(event) => setOrderId(event.target.value)} required>
                      {eligible.map((order) => 
                        <option key={order.id} value={order.id}>
                          {t.detail.order} #{order.id} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(order.createdAt))}
                        </option>
                      )}
                    </select>
                  </label>
                  <RatingPicker label={t.detail.productRating} value={productRating} onChange={setProductRating} t={t} />
                  <label>
                    {t.detail.productComment} 
                    <span className="optional-label">{t.detail.optional}</span>
                    <textarea name="productComment" rows="3" maxLength="2000" />
                  </label>
                  {!selectedOrder?.deliveryReviewed ? (
                    <>
                      <RatingPicker label={t.detail.deliveryRating} value={deliveryRating} onChange={setDeliveryRating} t={t} />
                      <label>
                        {t.detail.deliveryComment} 
                        <span className="optional-label">{t.detail.optional}</span>
                        <textarea name="deliveryComment" rows="3" maxLength="2000" />
                      </label>
                    </>
                  ) : (
                    <p className="delivery-already">{t.detail.deliveryReviewed}</p>
                  )}
                  {error && <p className="review-form-error" role="alert">{error}</p>}
                  <button className="btn" disabled={busy}>{busy ? t.detail.publishing : t.detail.publish}</button>
                </form> : 
                <p className="review-access-note">
                  {t.detail.noEligible}
                </p>
              }
          </section>
        </>}
      </motion.section>
    </motion.div>}
  </AnimatePresence>
}

function RatingPicker({ label, value, onChange, t }) {
  return <div className="rating-field"><span className="rating-label">{label}</span><div className="star-picker" role="radiogroup" aria-label={label}>{[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" role="radio" aria-checked={value === rating} aria-label={`${rating} ${rating === 1 ? t.detail.star : t.detail.stars}`} className={rating <= value ? 'selected' : ''} onClick={() => onChange(rating)}><Star size={24} strokeWidth={1.8} fill={rating <= value ? 'currentColor' : 'none'} aria-hidden="true" /></button>)}</div></div>
}

function CartDrawer({ open, onClose, cart, setCart, zones, customer, onOpenAccount, blocked, promo, setPromo, onSubmit, success, error, loadingOrder, prefersReducedMotion, t, formatMoney }) {
  const [checkout, setCheckout] = useState({ firstName: '', lastName: '', email: '', phone: '', zoneId: '', neighborhood: '', reference: '', paymentMethod: '', petName: '', petSize: '' })
  const petbox = cart.find((line) => line.isPetbox)
  const subtotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0)
  const zone = zones.find((item) => String(item.id) === checkout.zoneId)
  const discount = promo ? Math.round(subtotal * 10) / 100 : 0
  const count = cart.reduce((sum, line) => sum + line.quantity, 0)
  function change(id, amount) { setCart((lines) => lines.flatMap((line) => { if (line.id !== id) return [line]; if (line.isPetbox || line.quantity + amount < 1) return []; return [{ ...line, quantity: Math.min(line.stock, line.quantity + amount) }] })) }
  function update(field, value) {
    setCheckout((current) => ({ ...current, [field]: value }))
    if (field === 'petName') setCart((lines) => lines.map((line) => line.isPetbox ? { ...line, petName: value.trim() || null } : line))
  }
  async function submit(event) { event.preventDefault(); await onSubmit({ ...checkout, promoCode: promo ? 'PETNICA10' : null }, event.currentTarget) }
  return <AnimatePresence>
    {open && <>
      <motion.div 
        className="veil on" 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }} 
        onClick={onClose} />
      <motion.aside 
        id="cart" 
        className="on" 
        aria-label={t.cart.title} 
        aria-modal={!blocked} 
        role="dialog" 
        inert={blocked} 
        initial={{ x: prefersReducedMotion ? 0 : '100%' }} 
        animate={{ x: 0 }} exit={{ x: prefersReducedMotion ? 0 : '100%' }} 
        transition={{ type: 'spring', stiffness: 330, damping: 32 }}>
          
        <div className="cart-head">
          <div>
            <span className="eyebrow">{t.cart.eyebrow}</span>
            <h2>{t.cart.title} <span>{count ? `(${count})` : ''}</span></h2>
          </div>
          
          <button className="close-btn" type="button" aria-label={t.cart.close} onClick={onClose}><X size={20} strokeWidth={1.8} aria-hidden="true" /></button>
        </div>
      
        <div id="items">{cart.length ? cart.map((line) => 
          <div className="line" key={line.id}>
            <div>
              <b>{line.name}</b>
              <small>{line.presentation || (line.isPetbox ? t.cart.subscription : '')}</small>
              <div className="qty">
                <button type="button" aria-label={`${t.cart.decrease} ${line.name}`} onClick={() => change(line.id, -1)}>−</button>
                {line.quantity}{!line.isPetbox && 
                  <button type="button" 
                  aria-label={`${t.cart.increase} ${line.name}`} 
                  onClick={() => change(line.id, 1)} 
                  disabled={line.quantity >= line.stock}>+
                  </button>}
              </div>
            </div>
            <b>{formatMoney(line.price * line.quantity)}</b>
            </div>) : 
            <div className="cart-empty"><PawPrint size={20} aria-hidden="true" /><p className="sub">{t.cart.empty}</p></div>}
          </div>
          <form id="checkout" onSubmit={submit}>
            <h3>{t.cart.checkoutTitle}</h3>
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
            
            <label>{t.cart.zone}<select 
              name="zoneId" 
              value={checkout.zoneId} 
              onChange={(e) => update('zoneId', e.target.value)} required>
                <option value="">{zones.length ? t.cart.chooseDistrict : t.cart.loadingZones}</option>
                {zones.map((item) => <option key={item.id} value={item.id}>{item.district} · {formatMoney(item.fee)} · {item.days} {t.cart.days}</option>)}
              </select>
            </label>
            <label>{t.cart.neighborhood}<input name="neighborhood" maxLength="100" value={checkout.neighborhood} onChange={(e) => update('neighborhood', e.target.value)} required /></label>
            <label>{t.cart.reference}<textarea name="reference" rows="2" maxLength="2000" placeholder={t.cart.referencePlaceholder} value={checkout.reference} onChange={(e) => update('reference', e.target.value)} required /></label>
            {petbox && <div id="petFields">
              <h3>{t.cart.petDetails}</h3>
              <label>{t.cart.petName}<input name="petName" maxLength="80" value={checkout.petName} onChange={(e) => update('petName', e.target.value)} required /></label>
              {petbox.species === 'perro' && <label>{t.cart.petSize}<select name="petSize" value={checkout.petSize || petbox.size || ''} onChange={() => update('petSize', petbox.size)} required>
                <option value="">{t.cart.chooseSize}</option>
                {t.cart.petSizes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>}
            </div>}
            <label>{t.cart.payment}<select name="paymentMethod" value={checkout.paymentMethod} onChange={(e) => update('paymentMethod', e.target.value)} required>
              <option value="">{t.cart.choosePayment}</option>
              <option value="efectivo_contra_entrega">{t.cart.cash}</option>
              <option value="transferencia">{t.cart.transfer}</option>
            </select></label>
            <label className="promo-check"><input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} /> {t.cart.promoCheck} <b>PETNICA10</b> {t.cart.firstOrder}</label>
            <div className="sum">
              <div>
                <span>{t.cart.subtotal}</span><span>{formatMoney(subtotal)}</span>
              </div>
              {promo && 
                <div>
                  <span>{t.cart.promoEstimate}</span>
                  <span>− {formatMoney(discount)}</span>
                </div>}
                <div>
                  <span>{t.cart.shipping} {zone ? '' : t.cart.confirmShipping}</span>
                  <span>{zone ? formatMoney(zone.fee) : '—'}</span>
                </div>
              <div>
                <b>{t.cart.total} {zone ? '' : t.cart.estimated}</b>
                <b>{formatMoney(subtotal - discount + (Number(zone?.fee) || 0))}</b>
              </div>
            </div>
            <p className="shipping-note">
              {t.cart.shippingNote}
            </p>
            {!customer && <p className="checkout-account-note">
              {t.cart.accountRequired} 
              <button className="text-button" type="button" onClick={onOpenAccount}>{t.cart.accountButton}</button>
            </p>}
            {error && <p className="checkout-error" role="alert">{error}</p>}
            {success && 
            <div className="order-success" role="status">
              <b>{t.cart.success.replace('{id}', success.orderId)}</b>
              <span>{t.cart.orderTotal.replace('{total}', formatMoney(success.total))} {success.whatsapp ? t.cart.confirmWhatsapp : t.cart.contactSoon}</span>
              {success.whatsapp && 
              <a href={success.whatsapp} target="_blank" rel="noopener noreferrer">
                {t.cart.whatsapp} <ArrowUpRight size={15} aria-hidden="true" />
              </a>}
            </div>}
            <button className="btn submit-btn" type="submit" disabled={!customer || !cart.length || loadingOrder || Boolean(success)}>
              {loadingOrder ? t.cart.registering : success ? t.cart.registered : t.cart.submit}
            </button>
          </form>
      </motion.aside>
      </>
      }
    </AnimatePresence>
}

export default function Storefront() {
  const { language, setLanguage, t, locale } = useLanguage(storeTranslations)
  const formatMoney = (value) => money(value, locale)
  useEffect(() => {
    document.documentElement.lang = language
    document.title = t.documentTitle
  }, [language, t.documentTitle])
  const prefersReducedMotion = useReducedMotion()
  const csrfRef = useRef('')
  const [csrfToken, setCsrfToken] = useState('')
  const [year] = useState(() => new Date().getFullYear())
  const [catalog, setCatalog] = useState({ products: [], categories: [], plans: [], zones: [], whatsapp: '' })
  const [catalogError, setCatalogError] = useState('')
  const [species, setSpecies] = useState('perro')
  const [category, setCategory] = useState('Todo')
  const [cart, setCartState] = useState(savedCart.items)
  const cartRef = useRef(cart)
  const [customer, setCustomer] = useState(null)
  const [googleConfigured, setGoogleConfigured] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [orders, setOrders] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [productDetails, setProductDetails] = useState(null)
  const [activeProduct, setActiveProduct] = useState(null)
  const activeProductRef = useRef(null)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [promo, setPromo] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [orderSuccess, setOrderSuccess] = useState(null)
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [cartOwner, setCartOwner] = useState(savedCart.owner)
  const [cartPending, setCartPending] = useState(savedCart.pending)
  const [cartHydrated, setCartHydrated] = useState(false)
  const customerRef = useRef(null)
  const cartHydratedRef = useRef(false)
  const syncTimer = useRef(null)
  const cartRevision = useRef(0)
  const setCart = useCallback((value) => {
    const current = cartRef.current
    const next = typeof value === 'function' ? value(current) : value
    if (next === current) return
    cartRef.current = next
    setCartState(next)
    if (cartHydratedRef.current) {
      cartRevision.current += 1
      setCartOwner(customerRef.current?.id || null)
      if (customerRef.current) setCartPending(true)
    }
  }, [])
  const plans = useMemo(() => catalog.plans.filter((plan) => plan.species === species), [catalog.plans, species])
  const selectedPlan = plans.find((plan) => String(plan.id) === String(selectedPlanId)) || plans[0]
  const products = useMemo(() => catalog.products.filter((product) => (product.species === species || product.species === 'ambos') && (category === 'Todo' || product.category === category)), [catalog.products, species, category])

  const persistCart = useCallback(() => {
    if (!cartHydrated) return
    try { localStorage.setItem('petnica.cart', JSON.stringify({ 
      owner: customer?.id || cartOwner, 
      pending: cartPending, 
      items: cartRef.current })) } 
    catch { setAccountError(t.errors.localCart) }
  }, [cartHydrated, customer, cartOwner, cartPending, t])

  const accountRequest = useCallback((url, options = {}) => apiRequest(url, options, csrfRef.current), [])
  const syncCart = useCallback(async () => {
    if (!customer || !cartHydrated) return
    const revision = cartRevision.current
    const petbox = cartRef.current.find((line) => line.isPetbox)
    const body = { items: cartRef.current.filter((line) => !line.isPetbox).map(({ variantId, quantity }) => ({ variantId, quantity })), petbox: petbox ? { planId: petbox.planId, petName: petbox.petName || null, size: petbox.size || null } : null }
    try {
      await accountRequest('/api/account/cart', { method: 'PUT', body })
      if (revision === cartRevision.current) { setCartPending(false); persistCart() }
    } catch { setCartPending(true); persistCart(); setAccountError(t.errors.syncCart) }
  }, [accountRequest, cartHydrated, customer, persistCart, t])
  const scheduleSync = useCallback(() => { clearTimeout(syncTimer.current); syncTimer.current = setTimeout(() => syncCart(), 250) }, [syncCart])
  useEffect(() => {
    if (!cartHydrated) return
    persistCart()
    if (customer) scheduleSync()
  }, [cart, cartHydrated, customer, persistCart, scheduleSync])

  const mergeServerCart = useCallback((serverCart) => {
    const localOwned = customer?.id === cartOwner
    const localPending = localOwned && cartPending
    const guestCart = localOwned && !localPending ? [] : cartRef.current
    const merged = new Map()
    if (!localPending) for (const saved of serverCart.items || []) {
      const product = catalog.products.find((item) => item.variants.some((variant) => String(variant.id) === String(saved.variantId)))
      const variant = product?.variants.find((item) => String(item.id) === String(saved.variantId))
      if (product && variant && Number(variant.stock) > 0) merged.set(String(variant.id), { id: String(variant.id), variantId: String(variant.id), name: product.name, presentation: variant.presentation, price: Number(variant.price), stock: Number(variant.stock), quantity: Math.min(Number(saved.quantity), Number(variant.stock), 99) })
    }
    for (const line of guestCart.filter((item) => !item.isPetbox)) {
      const product = catalog.products.find((item) => item.variants.some((variant) => String(variant.id) === String(line.variantId)))
      const variant = product?.variants.find((item) => String(item.id) === String(line.variantId))
      if (!product || !variant || Number(variant.stock) < 1) continue
      const existing = merged.get(String(variant.id))
      if (existing) existing.quantity = Math.min(Number(variant.stock), existing.quantity + line.quantity)
      else merged.set(String(variant.id), { ...line, stock: Number(variant.stock), price: Number(variant.price), quantity: Math.min(line.quantity, Number(variant.stock)) })
    }
    const pet = guestCart.find((line) => line.isPetbox) || (!localPending && serverCart.petbox)
    const petPlan = plans.find((plan) => String(plan.id) === String(pet?.planId)) || catalog.plans.find((plan) => String(plan.id) === String(pet?.planId))
    const petLine = petPlan ? { id: 'petbox', isPetbox: true, planId: String(petPlan.id), species: petPlan.species, size: petPlan.size, name: petPlan.name, price: Number(petPlan.price), quantity: 1, petName: pet.petName || null } : null
    setCart([...merged.values(), ...(petLine ? [petLine] : [])])
    setCartHydrated(true)
    if (customer) { setCartOwner(customer.id); setCartPending(true) }
  }, [catalog, cartOwner, cartPending, customer, plans, setCart])

  useEffect(() => {
    let alive = true
    async function initialize() {
      try {
        const [session, response] = await Promise.all([accountRequest('/api/account/session').catch(() => null), fetch('/api/catalog')])
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la tienda.')
        if (!alive) return
        setCatalog(data)
        if (session) {
          csrfRef.current = session.csrfToken || ''
          setCsrfToken(session.csrfToken || '')
          setGoogleConfigured(Boolean(session.googleConfigured))
          if (session.authenticated) { customerRef.current = session.customer; setCustomer(session.customer) }
        }
        if (session?.authenticated) {
          const saved = await accountRequest('/api/account/cart').catch(() => ({ items: [], petbox: null }))
          if (!alive) return
          cartHydratedRef.current = true
          setCartHydrated(true)
          setCartOwner(session.customer.id)
          const localIsPending = session.customer.id === savedCart.owner && savedCart.pending
          const localCart = session.customer.id === savedCart.owner && !localIsPending ? [] : savedCart.items
          const merged = new Map()
          const addLine = (line, mergeQuantity = false) => {
            const product = data.products.find((item) => item.variants.some((variant) => String(variant.id) === String(line.variantId)))
            const variant = product?.variants.find((item) => String(item.id) === String(line.variantId))
            if (!product || !variant || Number(variant.stock) < 1) return
            const previous = merged.get(String(variant.id))
            const quantity = Math.min(Number(variant.stock), Number(line.quantity), 99)
            if (previous && mergeQuantity) previous.quantity = Math.min(Number(variant.stock), previous.quantity + quantity)
            else merged.set(String(variant.id), { id: String(variant.id), variantId: String(variant.id), name: product.name, presentation: variant.presentation, price: Number(variant.price), stock: Number(variant.stock), quantity })
          }
          if (!localIsPending) for (const line of saved.items || []) addLine(line)
          for (const line of localCart.filter((item) => !item.isPetbox)) addLine(line, true)
          const localPet = localCart.find((line) => line.isPetbox)
          const petData = localPet || (!localIsPending && saved.petbox)
          const pet = data.plans.find((plan) => String(plan.id) === String(petData?.planId))
          setCartPending(true)
          setCart([...merged.values(), ...(pet ? [{ id: 'petbox', isPetbox: true, planId: String(pet.id), species: pet.species, size: pet.size, name: pet.name, price: Number(pet.price), quantity: 1, petName: petData?.petName || null }] : [])])
        } else { cartHydratedRef.current = true; setCartHydrated(true) }
      } catch (error) { if (alive) setCatalogError(error.message) }
    }
    initialize()
    return () => { alive = false; clearTimeout(syncTimer.current) }
  }, [accountRequest, setCart])

  function addProduct(product, variant) {
    if (!variant || Number(variant.stock) < 1) return
    setOrderSuccess(null); setOrderError('')
    setCart((lines) => { const line = lines.find((item) => item.variantId === String(variant.id)); if (line) return lines.map((item) => item === line ? { ...item, quantity: Math.min(Number(variant.stock), item.quantity + 1) } : item); return [...lines, { id: String(variant.id), variantId: String(variant.id), name: product.name, presentation: variant.presentation, price: Number(variant.price), stock: Number(variant.stock), quantity: 1 }] })
    activeProductRef.current = null
    setActiveProduct(null)
    setProductDetails(null)
    setCartOpen(true)
  }
  function addPetbox() {
    if (!selectedPlan) return
    setOrderSuccess(null); setOrderError('')
    setCart((lines) => { const existing = lines.find((line) => line.isPetbox); 
      const line = { 
        id: 'petbox', 
        isPetbox: true, 
        planId: String(selectedPlan.id), 
        species: selectedPlan.species, 
        size: selectedPlan.size, 
        name: selectedPlan.name, 
        price: Number(selectedPlan.price), 
        quantity: 1, 
        petName: existing?.petName || null 
      }; return [...lines.filter((item) => !item.isPetbox), line] })
    setCartOpen(true)
  }
  async function openProduct(id) {
    const productId = String(id)
    activeProductRef.current = productId
    setActiveProduct(productId)
    setProductDetails({ loading: true })
    try {
      const result = await apiRequest(`/api/products/${encodeURIComponent(productId)}`, { cache: 'no-store' })
      if (activeProductRef.current === productId) setProductDetails(result)
    } catch (error) {
      if (activeProductRef.current === productId) setProductDetails({ error: error.message })
    }
  }
  async function handleProductClose(reload = false) {
    const id = activeProductRef.current
    activeProductRef.current = null
    setProductDetails(null)
    setActiveProduct(null)
    if (reload && id) {
      try {
        const result = await apiRequest(`/api/products/${encodeURIComponent(id)}`, { cache: 'no-store' })
        setCatalog((current) => ({ ...current, products: current.products.map((product) => String(product.id) === String(id) ? { ...product, rating: result.product.rating, reviewCount: result.product.reviewCount } : product) }))
      } catch {}
    }
  }
  async function refreshProductDetails() {
    const id = activeProductRef.current
    if (!id) return
    const result = await apiRequest(`/api/products/${encodeURIComponent(id)}`, { cache: 'no-store' })
    setProductDetails(result)
    setCatalog((current) => ({ ...current, products: current.products.map((product) => String(product.id) === String(id) ? { ...product, rating: result.product.rating, reviewCount: result.product.reviewCount } : product) }))
  }
  const loadOrders = useCallback(async () => { try { const result = await accountRequest('/api/account/orders'); setOrders(result.orders) } catch (error) { setOrders([]); setAccountError(error.message) } }, [accountRequest])
  async function handleAuth(result) {
    const nextCustomer = result.customer
    customerRef.current = nextCustomer
    setCustomer(nextCustomer)
    if (result.csrfToken) { csrfRef.current = result.csrfToken; setCsrfToken(result.csrfToken) }
    try { const saved = await accountRequest('/api/account/cart'); mergeServerCart(saved) } catch { setCartHydrated(true); setAccountError(t.errors.cartRestore) }
    setAccountOpen(true)
    if (activeProduct) {
      try {
        const detail = await apiRequest(`/api/products/${encodeURIComponent(activeProduct)}`)
        setProductDetails(detail)
      } catch {}
    }
  }
  function openAccount() { setAccountError(''); setOrders(customer ? null : []); setAccountOpen(true) }
  async function logout() {
    clearTimeout(syncTimer.current)
    const pet = cartRef.current.find((line) => line.isPetbox)
    let warning = ''
    try {
      await accountRequest('/api/account/cart', {
        method: 'PUT',
        body: {
          items: cartRef.current.filter((line) => !line.isPetbox).map(({ variantId, quantity }) => ({ variantId, quantity })),
          petbox: pet ? { planId: pet.planId, petName: pet.petName, size: pet.size } : null,
        },
      })
    } catch {
      warning = t.errors.logoutCart
    }
    try {
      await accountRequest('/api/account/logout', { method: 'POST' })
    } catch (error) {
      if (error.message !== 'Inicia sesión para continuar.') return setAccountError(error.message)
    }
    csrfRef.current = ''
    setCsrfToken('')
    customerRef.current = null
    setCustomer(null); setCartHydrated(true); setCartPending(false); setCartOwner(null); setOrders([]); setAccountError(warning)
  }
  async function submitOrder(payload) {
    if (!customer) { openAccount(); return }
    setLoadingOrder(true); setOrderError(''); setOrderSuccess(null)
    const petbox = cart.find((line) => line.isPetbox)
    const body = { ...payload, items: cart.filter((line) => !line.isPetbox).map(({ variantId, quantity }) => ({ variantId, quantity })), petbox: petbox ? { planId: petbox.planId, petName: payload.petName, size: petbox.species === 'perro' ? payload.petSize : null } : null }
    try {
      const result = await apiRequest('/api/orders', { method: 'POST', body })
      const message = [
        t.order.whatsappStart.replace('{id}', result.orderId),
        ...(result.items || []).map((item) => `- ${item.quantity} x ${item.name} (${formatMoney(item.price)})`),
        `${t.address.subtotal} ${formatMoney(result.subtotal)}`,
        `${t.address.discount} ${formatMoney(result.discount)}`,
        `${t.address.shipping} ${formatMoney(result.shipping)}`,
        `${t.order.total}: ${formatMoney(result.total)}`,
        `${t.address.delivery} ${result.shippingAddress}`,
        t.order.whatsappEnd,
      ].join('\n')
      setOrderSuccess({ ...result, whatsapp: result.whatsapp ? `https://wa.me/${encodeURIComponent(result.whatsapp)}?text=${encodeURIComponent(message)}` : '' })
      setCart([]); setPromo(false); if (accountOpen) loadOrders()
    } catch (error) { setOrderError(error.message) } finally { setLoadingOrder(false) }
  }
  function printInvoice(order) {
    const popup = window.open('', '_blank')
    if (!popup) return setAccountError(t.order.popupBlocked)
    popup.opener = null
    const productSubtotal = order.items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0)
    const rows = order.items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.quantity)}</td><td>${formatMoney(item.unitPrice)}</td><td>${formatMoney(Number(item.unitPrice) * Number(item.quantity))}</td></tr>`).join('') + (order.petboxName ? `<tr><td>${escapeHtml(order.petboxName)}${escapeHtml(t.order.petboxSubscription)}</td><td>1</td><td>${formatMoney(Number(order.subtotal) - productSubtotal)}</td><td>${formatMoney(Number(order.subtotal) - productSubtotal)}</td></tr>` : '')
    popup.document.write(`<!doctype html><html lang="${language}"><meta charset="utf-8"><title>${escapeHtml(t.order.invoiceTitle)} PetNica #${escapeHtml(order.id)}</title><style>body{font:15px/1.5 Arial,sans-serif;color:#173d3b;max-width:760px;margin:36px auto;padding:0 22px}h1{color:#148d80}table{width:100%;border-collapse:collapse;margin-top:15px}td,th{padding:10px 7px;border-bottom:1px solid #d9e8e5;text-align:left}</style><h1>PetNica</h1><p>${escapeHtml(t.order.invoiceTitle)} #${escapeHtml(order.id)}</p><p>${escapeHtml(order.firstName)} ${escapeHtml(order.lastName)} · ${escapeHtml(order.email)}</p><p>${escapeHtml(order.shippingAddress)}</p><table><thead><tr><th>${escapeHtml(t.order.item)}</th><th>${escapeHtml(t.order.quantity)}</th><th>${escapeHtml(t.order.price)}</th><th>${escapeHtml(t.order.total)}</th></tr></thead><tbody>${rows}</tbody></table><p>${escapeHtml(t.address.subtotal)} ${formatMoney(order.subtotal)} · ${escapeHtml(t.address.discount)} − ${formatMoney(order.discount)} · ${escapeHtml(t.address.shipping)} ${formatMoney(order.shipping)}</p><h2>${escapeHtml(t.order.total)}: ${formatMoney(order.total)}</h2><button onclick="window.print()">${escapeHtml(t.order.print)}</button><p>${escapeHtml(t.order.note)}</p></html>`)
    popup.document.close()
  }
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (accountOpen) setAccountOpen(false)
        else if (activeProductRef.current) {
          activeProductRef.current = null
          setActiveProduct(null)
          setProductDetails(null)
        } else if (cartOpen) setCartOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [accountOpen, cartOpen])
  useEffect(() => {
    if (!customer || !cartHydrated) return
    const saveBeforeLeave = () => {
      clearTimeout(syncTimer.current)
      const petbox = cartRef.current.find((line) => line.isPetbox)
      const body = { items: cartRef.current.filter((line) => !line.isPetbox).map(({ variantId, quantity }) => ({ variantId, quantity })), petbox: petbox ? { planId: petbox.planId, petName: petbox.petName || null, size: petbox.size || null } : null }
      fetch('/api/account/cart', { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfRef.current }, 
        body: JSON.stringify(body), 
        keepalive: true 
      }).catch(() => {})
    }
    window.addEventListener('pagehide', saveBeforeLeave)
    return () => window.removeEventListener('pagehide', saveBeforeLeave)
  }, [customer, cartHydrated])
  const categories = [{ value: 'Todo', label: t.shop.all }, ...catalog.categories.map((item) => ({ value: item.name, label: item.name }))]

  return <>
    <div className="promo"><PawPrint size={16} strokeWidth={2} aria-hidden="true" /> {t.promo} <b>PETNICA10</b></div>
    <header className="top">
      <div className="wrap bar">
        <a className="logo brand-logo" href="#top" aria-label={t.hero.homeAria}><span className="brand-logo-frame"><img src={brandIcon} alt="" width="1408" height="768" /></span></a>
        <nav className="links" aria-label={t.nav.store}>
          <a href="#tienda">{t.nav.store}</a><a href="#petbox">{t.nav.petbox}</a>
         <a href="#como">{t.nav.how}</a>
        </nav>

        <button className="accountbtn" type="button" onClick={openAccount}>{customer ? `${t.account.hello}, ${customer.firstName}` : t.nav.account}</button>
        <button className="cartbtn" type="button" aria-label={t.nav.cart} onClick={() => setCartOpen(true)}>{t.nav.cart} <b>{cart.reduce((sum, line) => sum + line.quantity, 0)}</b></button>
        
        <label className="language-picker">
          <span className="visually-hidden">
            {t.language}
          </span>
          <select aria-label={t.language} value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="es">{t.spanish}</option>
            <option value="en">{t.english}</option>
          </select>
        </label>
     </div>
    </header>

    <main id="top" className="wrap">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span /> {t.hero.eyebrow}</span>
            <h1>{t.hero.titleStart} <em>{t.hero.titleAccent}</em> {t.hero.titleEnd}</h1>
            <p className="lead">{catalogError ? t.hero.loadError : t.species[species].lead}</p>
            
            <div className="pick" role="group" aria-label={t.hero.speciesPicker}>
              {['perro', 'gato'].map((kind) => <button key={kind} type="button" aria-pressed={species === kind} onClick={() => { setSpecies(kind); setCategory('Todo') }}><span className="em">{storeTranslations.es.species[kind].emoji}</span>{t.species[kind].button}</button>)}</div><a className="btn" href="#tienda">{t.hero.discover} <ArrowRight size={17} strokeWidth={2} aria-hidden="true" /></a><div className="hero-note"><Sparkles size={16} strokeWidth={1.8} aria-hidden="true" /> {t.hero.delivery}</div></div><div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><motion.div className="stage" key={species} initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : .9, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: -4 }} transition={{ duration: prefersReducedMotion ? 0 : .35 }}><img src={speciesImages[species]} alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextSibling.hidden = false }} /><span hidden>{t.species[species].emoji}</span></motion.div><span className="float-tag tag-top">{t.hero.loveTag} <Heart size={15} fill="currentColor" aria-hidden="true" /></span><span className="float-tag tag-bottom"><PawPrint size={17} aria-hidden="true" /> {t.hero.happyTogether}</span><Sparkles className="spark spark-one" size={32} aria-hidden="true" /><Sparkles className="spark spark-two" size={20} aria-hidden="true" /></div></section>
      <div className="trust-row" aria-label={t.hero.benefits}>
        <div>
          <span><Truck size={22} strokeWidth={1.9} aria-hidden="true" /></span>
          <b>{t.trust[0][0]}</b>
          <small>{t.trust[0][1]}</small>
        </div>
        <div>
          <span><HeartHandshake size={22} strokeWidth={1.9} aria-hidden="true" /></span>
          <b>{t.trust[1][0]}</b>
          <small>{t.trust[1][1]}</small>
        </div>
        <div>
          <span><MessageCircle size={22} strokeWidth={1.9} aria-hidden="true" /></span>
          <b>{t.trust[2][0]}</b>
          <small>{t.trust[2][1]}</small>
        </div>
      </div>
      <section id="tienda" className="shop-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              {t.shop.eyebrow}
            </span>
            <h2>{t.species[species].title}</h2>
          </div>
          <p className="sub">{t.shop.subtitle}</p>
        </div>
        <div className="chips" role="group" aria-label={t.shop.categoryFilter}>{categories.map((item) => <button type="button" key={item.value} aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}
        </div>
      <motion.div className="grid" layout aria-live="polite">{catalogError ? 
        <p className="empty">{catalogError}</p> : products.length ? products.map((product) => 
          <motion.article 
            className="card" 
            key={product.id} 
            layout initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: prefersReducedMotion ? 0 : .22 }} 
            onClick={(event) => { if (!event.target.closest('button,select,label')) openProduct(product.id) }}>
           
           <button 
              className="product-photo product-open" 
              type="button" 
              aria-label={`${t.shop.viewDetails} ${product.name}`} 
              onClick={() => openProduct(product.id)}>
                
             {imageUrl(product.image) && 
              <img 
                src={imageUrl(product.image)} 
                alt="" 
                loading="lazy" 
                onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextSibling.hidden = false }} />}
                  <PawPrint className="empty-product-icon" size={42} strokeWidth={1.4} aria-hidden="true" hidden={Boolean(imageUrl(product.image))} />
            </button>
            
            <h3>{product.name}</h3>
            
            <div className="card-rating">{product.reviewCount ? <>
            
            <Stars rating={product.rating} label={`${Number(product.rating).toFixed(1)} ${t.detail.rating}`} />
            
            <span>{Number(product.rating).toFixed(1)} · {product.reviewCount} {product.reviewCount === 1 ? t.shop.reviewsOne : t.shop.reviewsMany}</span></> : <span className="no-rating">{t.shop.noRating}</span>}</div><p className="description">{product.description || product.category}</p><label className="visually-hidden" htmlFor={`variant-${product.id}`}>{t.shop.variantLabel} {product.name}</label><select id={`variant-${product.id}`} className="variant-select" hidden={product.variants.length === 1} defaultValue={String(product.variants[0]?.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setCatalog((current) => ({ ...current, products: current.products.map((item) => item.id === product.id ? { ...item, selectedVariantId: event.target.value } : item) }))}>{product.variants.map((variant) => <option key={variant.id} value={variant.id} disabled={Number(variant.stock) < 1}>{variant.presentation}{Number(variant.stock) < 1 ? ` · ${t.shop.outOfStock}` : ''}</option>)}</select><button className="product-details-link" type="button" onClick={() => openProduct(product.id)}>{t.shop.details} <ArrowRight size={14} aria-hidden="true" /></button><div className="row"><span className="price">{formatMoney((product.variants.find((variant) => String(variant.id) === String(product.selectedVariantId)) || product.variants[0])?.price)}</span>{(() => { const variant = product.variants.find((item) => String(item.id) === String(product.selectedVariantId)) || product.variants[0]; return <button className="btn add-product" type="button" disabled={!variant || Number(variant.stock) < 1} onClick={() => addProduct(product, variant)}>{!variant || Number(variant.stock) < 1 ? t.shop.outOfStock : t.shop.add}</button> })()}</div><small className="stock">{product.variants.some((item) => Number(item.stock) > 0) ? `${t.shop.available} · ${Number(product.variants.find((variant) => String(variant.id) === String(product.selectedVariantId))?.stock ?? product.variants[0]?.stock)} ${t.shop.inStock}` : t.shop.noStock}</small></motion.article>) : catalog.products.length ? <p className="empty">{t.shop.empty}</p> : <p className="empty">{t.shop.loading}</p>}</motion.div></section>
     
      <section id="petbox" className="petbox-section">
        <div className="box"><div className="box-copy">
          <span className="eyebrow">{t.petbox.eyebrow}</span>
          <h2>{t.petbox.title}<br />{t.petbox.titleSecond}</h2>
          <p className="sub">{t.petbox.description}</p>
            <div className="sizes" role="group" aria-label={t.petbox.planPicker}>{plans.map((plan) => 
              <button 
                type="button" 
                key={plan.id} 
                aria-pressed={String(selectedPlan?.id) === String(plan.id)} 
                onClick={() => setSelectedPlanId(String(plan.id))}
              >
                {plan.size || t.petbox.catPlan}
              </button>)}
            </div>
        </div>
        <div className="box-visual">
          <Sparkles className="box-doodle doodle-one" size={32} aria-hidden="true" />
          <Heart className="box-doodle doodle-two" size={30} fill="currentColor" aria-hidden="true" />
          <div className="gift-box" aria-hidden="true">
            <PawPrint className="gift-paw" size={34} aria-hidden="true" /><b>PET<br />BOX</b>
          </div>
            <div className="box-price-wrap">
              <small>{t.petbox.from}</small>
                <div className="big">
                  {selectedPlan ? `${formatMoney(selectedPlan.price)} ${t.petbox.priceSuffix}` : t.petbox.unavailable}
                </div>
              <small>{t.petbox.monthly}</small>
            </div>
          <button className="btn" id="addBox" type="button" disabled={!selectedPlan} onClick={addPetbox}>
            {t.petbox.action} <ArrowRight size={17} aria-hidden="true" />
          </button>
          </div>
        </div>
      </section>
      <section id="como" className="how-section">
        <span className="eyebrow">{t.how.eyebrow}</span>
        <h2>{t.how.title}</h2>
        <p className="sub">{t.how.subtitle}</p>
        <ol className="steps">
          <li>
            <span>01</span>
              <b>{t.how.steps[0][0]}</b>
            <small>{t.how.steps[0][1]}</small>
          </li>
          <li>
            <span>02</span>
              <b>{t.how.steps[1][0]}</b>
            <small>{t.how.steps[1][1]}</small>
          </li>
          <li>
            <span>03</span>
              <b>{t.how.steps[2][0]}</b>
            <small>{t.how.steps[2][1]}</small>
          </li>
          <li>
            <span>04</span>
              <b>{t.how.steps[3][0]}</b>
            <small>{t.how.steps[3][1]}</small>
          </li>
        </ol>
      </section>
    </main>
    <footer>
      <div className="wrap footer-inner">
        <div>
          <a className="logo brand-logo" href="#top" aria-label={t.hero.homeAria}><span className="brand-logo-frame"><img src={brandIcon} alt="" width="1408" height="768" /></span></a>
          <p>{t.footer.motto}</p>
        </div>
        <div className="footer-right">
          <span>{t.footer.location}</span>
          <span>{t.footer.socials}</span>
          <small>© {year} PetNica · {t.footer.copyright}</small>
        </div>
      </div>
    </footer>
    <CartDrawer 
      open={cartOpen} 
      onClose={() => setCartOpen(false)} 
      cart={cart} 
      setCart={setCart} 
      zones={catalog.zones} 
      customer={customer} 
      onOpenAccount={openAccount} 
      blocked={accountOpen} 
      promo={promo} 
      setPromo={setPromo} 
      onSubmit={submitOrder} 
      success={orderSuccess} 
      error={orderError} 
      loadingOrder={loadingOrder} 
      prefersReducedMotion={prefersReducedMotion} 
      t={t}
      formatMoney={formatMoney}
    />
    <AccountDialog 
      open={accountOpen} 
      onClose={() => setAccountOpen(false)} 
      customer={customer} 
      csrf={csrfToken} 
      setCsrf={(value) => { csrfRef.current = value; setCsrfToken(value) }} 
      onAuth={handleAuth} 
      onLogout={logout} 
      googleConfigured={googleConfigured} 
      error={accountError} 
      setError={setAccountError} 
      loadOrders={loadOrders} 
      orders={orders} 
      onInvoice={printInvoice} 
      prefersReducedMotion={prefersReducedMotion} 
      t={t}
      locale={locale}
      formatMoney={formatMoney}
    />
    <ProductDialog 
      key={activeProduct || 'product'} 
      details={productDetails} 
      onClose={handleProductClose} 
      onAdd={addProduct} 
      onReviewSubmitted={refreshProductDetails} 
      customer={customer} 
      csrf={csrfToken} 
      onLogin={() => { setAccountOpen(true); setAccountError('') }} 
      prefersReducedMotion={prefersReducedMotion} 
      t={t}
      locale={locale}
      formatMoney={formatMoney}
    />
  </>
}
