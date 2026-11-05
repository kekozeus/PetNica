import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, LockKeyhole, PawPrint, ShoppingCart, X } from 'lucide-react'

import { apiRequest, imageUrl } from '../../lib/api.js'
import Stars from './Stars.jsx'
import ReviewList from './ReviewList.jsx'
import RatingPicker from './RatingPicker.jsx'

export default function ProductDialog({ details, onClose, onAdd, onReviewSubmitted, customer, csrf, onLogin, prefersReducedMotion, t, locale, formatMoney }) {
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
  const hasReviewed = Boolean(details?.hasReviewed)
  const canWrite = !hasReviewed || eligible.length > 0
  const [orderId, setOrderId] = useState('')
  const selectedOrderId = orderId || String(eligible[0]?.id || '')

  async function submitReview(event) {
    event.preventDefault()
    const wantsProduct = !hasReviewed && productRating > 0
    const wantsDelivery = eligible.length > 0 && deliveryRating > 0
    if (!wantsProduct && !wantsDelivery) return setError(t.detail.reviewError)

    setBusy(true)
    setError('')

    const data = new FormData(event.currentTarget)

    try {
      await apiRequest('/api/account/reviews', {
        method: 'POST',
        body: {
          productId: product.id,
          orderId: eligible.length ? selectedOrderId : null,
          productRating: wantsProduct ? productRating : null,
          productComment: data.get('productComment'),
          deliveryRating: wantsDelivery ? deliveryRating : null,
          deliveryComment: data.get('deliveryComment')
        }
      }, csrf)
      await onReviewSubmitted()
      setOrderId('')
      setProductRating(0)
      setDeliveryRating(0)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {details && (
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
          }}
        >
          <motion.section
            className="product-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="productDialogTitle"
            initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : .97, y: prefersReducedMotion ? 0 : 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : .98 }}
            transition={{ duration: prefersReducedMotion ? 0 : .2 }}
          >
            <div className="product-dialog-head">
              <span className="eyebrow">{t.detail.eyebrow}</span>
              <button className="close-btn" type="button" aria-label={t.detail.close} onClick={() => onClose()}>
                <X size={20} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>

            {!product ? (
              <p className={details.error ? 'account-error' : 'empty'} role={details.error ? 'alert' : undefined}>
                {details.error || t.detail.loading}
              </p>
            ) : (
              <>
                <div className="detail-layout">
                  <div className="detail-gallery">
                    <div className="detail-image">
                      {imageUrl(product.image) && (
                        <img
                          src={imageUrl(product.image)}
                          alt={product.name}
                          onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextSibling.hidden = false }}
                        />
                      )}
                      <PawPrint className="empty-product-icon" size={64} strokeWidth={1.2} aria-hidden="true" hidden={Boolean(imageUrl(product.image))} />
                    </div>
                    <span className="detail-category">{product.category || t.detail.category}</span>
                  </div>

                  <div className="detail-copy">
                    <span className="eyebrow">{t.detail.madeFor}</span>
                    <h2 id="productDialogTitle">{product.name}</h2>

                    <div className="detail-rating">
                      <Stars
                        rating={product.reviewCount ? product.rating : 0}
                        label={product.reviewCount ? `${Number(product.rating).toFixed(1)} ${t.detail.rating}` : t.shop.noRating}
                      />
                      <span className={product.reviewCount ? '' : 'no-rating'}>
                        {product.reviewCount
                          ? `${Number(product.rating).toFixed(1)} · ${product.reviewCount} ${product.reviewCount === 1 ? t.shop.reviewsOne : t.shop.reviewsMany}`
                          : t.shop.noRating}
                      </span>
                    </div>

                    <p className="detail-description">{product.description || t.detail.fallbackDescription}</p>

                    <div className="buy-panel">
                      {variants.length > 1 && (
                        <>
                          <span className="detail-variant-label" id="detailVariantLabel">{t.detail.presentation}</span>
                          {variants.length <= 4 ? (
                            <div className="variant-pills" role="group" aria-labelledby="detailVariantLabel">
                              {variants.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  aria-pressed={String(item.id) === selectedVariantId}
                                  disabled={Number(item.stock) < 1}
                                  onClick={() => setVariantId(String(item.id))}
                                >
                                  {item.presentation}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="select-wrap">
                              <select
                                id="detailVariant"
                                aria-labelledby="detailVariantLabel"
                                value={selectedVariantId}
                                onChange={(event) => setVariantId(event.target.value)}
                              >
                                {variants.map((item) => (
                                  <option key={item.id} value={item.id} disabled={Number(item.stock) < 1}>
                                    {item.presentation}{Number(item.stock) < 1 ? ` · ${t.shop.outOfStock}` : ''}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
                            </span>
                          )}
                        </>
                      )}

                      <div className="buy-row">
                        <span className="detail-price">{variant ? formatMoney(variant.price) : t.shop.noStock}</span>
                        <button
                          className="btn buy-btn"
                          type="button"
                          disabled={!variant || Number(variant.stock) < 1}
                          onClick={() => onAdd(product, variant)}
                        >
                          {!variant || Number(variant.stock) < 1 ? t.shop.outOfStock : (
                            <><ShoppingCart size={17} strokeWidth={2.2} aria-hidden="true" />{t.shop.add}</>
                          )}
                        </button>
                      </div>

                      <small className={`stock${!variant || Number(variant.stock) < 1 ? ' out' : ''}`}>
                        {variant && Number(variant.stock) > 0 ? `${t.shop.available} · ${variant.stock} ${t.shop.inStock}` : t.shop.noStock}
                      </small>
                    </div>
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
                  {!customer ? (
                    <div className="review-access">
                      <LockKeyhole size={24} strokeWidth={1.8} aria-hidden="true" />
                      <div>
                        <b>{t.detail.reviewAccessTitle}</b>
                        <p>{t.detail.reviewAccessText}</p>
                      </div>
                      <button className="btn" type="button" onClick={onLogin}>{t.detail.login}</button>
                    </div>
                  ) : canWrite ? (
                    <form className="review-form" onSubmit={submitReview}>
                      <h3>{t.detail.reviewIntro}</h3>
                      <p className="form-intro">{t.detail.reviewHelp}</p>

                      {!hasReviewed && (
                        <>
                          <RatingPicker label={t.detail.productRating} value={productRating} onChange={setProductRating} t={t} />

                          <label>
                            {t.detail.productComment}
                            <span className="optional-label">{t.detail.optional}</span>
                            <textarea name="productComment" rows="3" maxLength="2000" />
                          </label>
                        </>
                      )}

                      {eligible.length > 0 && (
                        <>
                          <label>
                            {t.detail.deliveredOrder}
                            <span className="select-wrap">
                              <select name="orderId" value={selectedOrderId} onChange={(event) => setOrderId(event.target.value)} required>
                                {eligible.map((order) => (
                                  <option key={order.id} value={order.id}>
                                    {t.detail.order} #{order.id} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(order.createdAt))}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
                            </span>
                          </label>

                          <RatingPicker label={t.detail.deliveryRating} value={deliveryRating} onChange={setDeliveryRating} t={t} />
                          <label>
                            {t.detail.deliveryComment}
                            <span className="optional-label">{t.detail.optional}</span>
                            <textarea name="deliveryComment" rows="3" maxLength="2000" />
                          </label>
                        </>
                      )}

                      {error && <p className="review-form-error" role="alert">{error}</p>}

                      <button className="btn" disabled={busy}>{busy ? t.detail.publishing : t.detail.publish}</button>
                    </form>
                  ) : (
                    <p className="review-access-note">{t.detail.alreadyReviewed}</p>
                  )}
                </section>
              </>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
