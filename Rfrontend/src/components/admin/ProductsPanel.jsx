import { ChevronDown, Search } from 'lucide-react'

import Field from './Field.jsx'
import AdminProductCard from './AdminProductCard.jsx'

export default function ProductsPanel({ t, overview, filteredProducts, productQuery, onProductQuery, onCreateProduct, onUpdateProduct, onUpdateVariant, onCreateVariant, onUploadImage, onRemoveImage }) {
  return (
    <section className="tab-panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">{t.products.eyebrow}</span>
          <h2>{t.products.title}</h2>
        </div>
        <span className="count-pill">{overview.products.length}</span>
      </div>

      <div className="admin-list-toolbar">
        <label className="admin-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={productQuery}
            onChange={(event) => onProductQuery(event.target.value)}
            placeholder={t.products.searchPlaceholder}
            aria-label={t.products.search}
          />
        </label>
        <span className="admin-result-count">{filteredProducts.length} / {overview.products.length}</span>
      </div>

      <details className="create-box">
        <summary>{t.products.add}<ChevronDown size={17} aria-hidden="true" /></summary>
        <form className="product-form" onSubmit={onCreateProduct}>
          <div className="form-grid">
            <Field label={t.products.name}><input name="name" maxLength="150" required /></Field>
            <Field label={t.products.slug}><input name="slug" maxLength="160" placeholder={t.products.slugPlaceholder} /></Field>
            <Field label={t.products.category}>
              <select name="categoryId" required>
                <option value="">{t.products.chooseCategory}</option>
                {overview.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </Field>
            <Field label={t.products.for}>
              <select name="species" required>
                <option value="perro">{t.products.dog}</option>
                <option value="gato">{t.products.cat}</option>
                <option value="ambos">{t.products.both}</option>
              </select>
            </Field>
            <Field label={t.products.initialPresentation}><input name="presentation" maxLength="60" placeholder={t.products.initialPlaceholder} required /></Field>
            <Field label={t.products.sku}><input name="sku" maxLength="40" required /></Field>
            <Field label={t.products.price}><input name="price" type="number" min="0" step="0.01" required /></Field>
            <Field label={t.products.stock}><input name="stock" type="number" min="0" step="1" required /></Field>
          </div>
          <Field label={t.products.description}><textarea name="description" maxLength="5000" rows="2" /></Field>
          <button className="button primary" type="submit">{t.products.create}</button>
        </form>
      </details>

      <div className="product-list">
        {filteredProducts.length ? filteredProducts.map((product) => (
          <AdminProductCard
            key={product.id}
            product={product}
            categories={overview.categories}
            t={t}
            onUpdate={onUpdateProduct}
            onUpdateVariant={onUpdateVariant}
            onCreateVariant={onCreateVariant}
            onUploadImage={onUploadImage}
            onRemoveImage={onRemoveImage}
          />
        )) : overview.products.length ? (
          <p className="empty">{t.products.noSearchResults}</p>
        ) : (
          <p className="empty">{t.products.empty}</p>
        )}
      </div>
    </section>
  )
}
