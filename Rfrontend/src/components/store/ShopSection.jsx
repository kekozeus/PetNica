import { motion } from 'framer-motion'

import ProductCard from './ProductCard.jsx'

export default function ShopSection({ t, species, categories, category, onSelectCategory, catalogError, products, catalogProductCount, onOpen, onAdd, onSelectVariant, prefersReducedMotion, formatMoney }) {
  return (
    <section id="tienda" className="shop-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t.shop.eyebrow}</span>
          <h2>{t.species[species].title}</h2>
        </div>
        <p className="sub">{t.shop.subtitle}</p>
      </div>

      <div className="chips" role="group" aria-label={t.shop.categoryFilter}>
        {categories.map((item) => (
          <button type="button" key={item.value} aria-pressed={category === item.value} onClick={() => onSelectCategory(item.value)}>
            {item.label}
          </button>
        ))}
      </div>

      <motion.div className="grid" layout aria-live="polite">
        {catalogError ? (
          <p className="empty">{catalogError}</p>
        ) : products.length ? products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onOpen={onOpen}
            onAdd={onAdd}
            onSelectVariant={onSelectVariant}
            prefersReducedMotion={prefersReducedMotion}
            t={t}
            formatMoney={formatMoney}
          />
        )) : catalogProductCount ? (
          <p className="empty">{t.shop.empty}</p>
        ) : (
          <p className="empty">{t.shop.loading}</p>
        )}
      </motion.div>
    </section>
  )
}
