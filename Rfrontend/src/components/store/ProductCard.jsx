import { motion } from 'framer-motion'
import { ArrowUpRight, ChevronDown, PawPrint, ShoppingCart } from 'lucide-react'

import { imageUrl } from '../../lib/api.js'
import Stars from './Stars.jsx'

export default function ProductCard({ product, onOpen, onAdd, onSelectVariant, prefersReducedMotion, t, formatMoney }) {
  const variant = product.variants.find((item) => String(item.id) === String(product.selectedVariantId)) || product.variants[0]
  const soldOut = !product.variants.some((item) => Number(item.stock) > 0)
  const lowStock = variant && Number(variant.stock) > 0 && Number(variant.stock) <= 5

  return (
    <motion.article
      className={`card${soldOut ? ' is-soldout' : ''}`}
      layout
      initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : .22 }}
      onClick={(event) => { if (!event.target.closest('button,select,label')) onOpen(product.id) }}
    >
      <button
        className="product-photo product-open"
        type="button"
        aria-label={`${t.shop.viewDetails} ${product.name}`}
        onClick={() => onOpen(product.id)}
      >
        {imageUrl(product.image) && (
          <img
            src={imageUrl(product.image)}
            alt=""
            loading="lazy"
            onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextSibling.hidden = false }}
          />
        )}
        <PawPrint className="empty-product-icon" size={42} strokeWidth={1.4} aria-hidden="true" hidden={Boolean(imageUrl(product.image))} />
        <span className="photo-cta" aria-hidden="true"><ArrowUpRight size={16} strokeWidth={2.4} /></span>
        {soldOut && <span className="soldout-tag">{t.shop.outOfStock}</span>}
      </button>

      <h3>{product.name}</h3>

      <div className="card-rating">
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

      <p className="description">{product.description || product.category}</p>

      {product.variants.length > 1 && (product.variants.length <= 4 ? (
        <div className="variant-pills" role="group" aria-label={`${t.shop.variantLabel} ${product.name}`}>
          {product.variants.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={String(item.id) === String(variant?.id)}
              disabled={Number(item.stock) < 1}
              onClick={() => onSelectVariant(product.id, item.id)}
            >
              {item.presentation}
            </button>
          ))}
        </div>
      ) : (
        <>
          <label className="visually-hidden" htmlFor={`variant-${product.id}`}>{t.shop.variantLabel} {product.name}</label>
          <span className="select-wrap" onClick={(event) => event.stopPropagation()}>
            <select
              id={`variant-${product.id}`}
              className="variant-select"
              value={String(variant?.id || '')}
              onChange={(event) => onSelectVariant(product.id, event.target.value)}
            >
              {product.variants.map((item) => (
                <option key={item.id} value={item.id} disabled={Number(item.stock) < 1}>
                  {item.presentation}{Number(item.stock) < 1 ? ` · ${t.shop.outOfStock}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </>
      ))}

      <div className="row">
        <span className="price">{formatMoney(variant?.price)}</span>
        <button
          className="btn add-product"
          type="button"
          disabled={!variant || Number(variant.stock) < 1}
          onClick={() => onAdd(product, variant)}
        >
          {!variant || Number(variant.stock) < 1 ? t.shop.outOfStock : (
            <><ShoppingCart size={14} strokeWidth={2.4} aria-hidden="true" />{t.shop.add}</>
          )}
        </button>
      </div>

      {lowStock && <small className="stock low">{t.shop.lowStock.replace('{count}', variant.stock)}</small>}
    </motion.article>
  )
}
