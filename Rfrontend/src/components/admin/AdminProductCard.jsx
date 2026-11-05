import { ChevronDown, Package } from 'lucide-react'

import { imageUrl } from '../../lib/api.js'
import Field from './Field.jsx'
import ProductImageForm from './ProductImageForm.jsx'

export default function AdminProductCard({ product, categories, t, onUpdate, onUpdateVariant, onCreateVariant, onUploadImage, onRemoveImage }) {
  const totalStock = product.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)

  return (
    <details className="product-card">
      <summary className="product-summary">
        <span className="product-summary-thumb">
          {imageUrl(product.image) ? <img src={imageUrl(product.image)} alt="" /> : <Package size={21} aria-hidden="true" />}
        </span>
        <span className="product-summary-main">
          <strong>{product.name}</strong>
          <small>{product.category} · {product.variants.length} {t.products.variants}</small>
        </span>
        <span className={`product-state${product.active ? ' is-active' : ' is-hidden'}`}>
          {product.active ? t.products.active : t.products.hidden}
        </span>
        <span className="product-summary-stock"><b>{totalStock}</b> {t.products.stock}</span>
        <span className="product-summary-action">{t.products.edit}<ChevronDown size={16} aria-hidden="true" /></span>
      </summary>

      <div className="product-card-body">
        <div className="product-grid">
          <div>
            <div className="product-image">
              {imageUrl(product.image) ? <img src={imageUrl(product.image)} alt={product.name} /> : t.products.noImage}
            </div>
            <ProductImageForm product={product} onUpload={onUploadImage} onRemove={onRemoveImage} t={t} />
          </div>

          <div>
            <form className="product-edit" onSubmit={(event) => onUpdate(event, product)}>
              <div className="product-fields">
                <Field label={t.products.name}><input name="name" maxLength="150" defaultValue={product.name} required /></Field>
                <Field label={t.products.slug}><input name="slug" maxLength="160" defaultValue={product.slug} required /></Field>
                <Field label={t.products.category}>
                  <select name="categoryId" defaultValue={product.categoryId}>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </Field>
                <Field label={t.products.for}>
                  <select name="species" defaultValue={product.species}>
                    <option value="perro">{t.products.dog}</option>
                    <option value="gato">{t.products.cat}</option>
                    <option value="ambos">{t.products.both}</option>
                  </select>
                </Field>
                <label className="active-check"><input name="active" type="checkbox" defaultChecked={product.active} /> {t.products.visible}</label>
              </div>

              <Field label={t.products.description}>
                <textarea name="description" maxLength="5000" rows="2" defaultValue={product.description || ''} />
              </Field>

              <button className="button outline small" type="submit">{t.products.saveProduct}</button>
            </form>

            <div className="variant-list">
              <b>{t.products.inventory}</b>

              {product.variants.length ? product.variants.map((variant) => (
                <form className="variant-row" key={variant.id} onSubmit={(event) => onUpdateVariant(event, variant)}>
                  <Field label={t.products.sku}><input name="sku" maxLength="40" defaultValue={variant.sku} required /></Field>
                  <Field label={t.products.presentation}><input name="presentation" maxLength="60" defaultValue={variant.presentation} required /></Field>
                  <Field label={t.products.variantPrice}><input name="price" type="number" min="0" step="0.01" defaultValue={variant.price} required /></Field>
                  <Field label={t.products.stock}><input name="stock" type="number" min="0" step="1" defaultValue={variant.stock} required /></Field>
                  <label className="active-check"><input name="active" type="checkbox" defaultChecked={variant.active} /> {t.products.active}</label>
                  <button className="button outline small" type="submit">{t.products.save}</button>
                </form>
              )) : <p className="help-text">{t.products.noVariants}</p>}

              <details className="variant-create-box">
                <summary>{t.products.addVariant}<ChevronDown size={15} aria-hidden="true" /></summary>
                <form className="variant-create" onSubmit={(event) => onCreateVariant(event, product)}>
                  <div className="form-grid">
                    <Field label={t.products.sku}><input name="sku" maxLength="40" required /></Field>
                    <Field label={t.products.presentation}><input name="presentation" maxLength="60" required /></Field>
                    <Field label={t.products.variantPrice}><input name="price" type="number" min="0" step="0.01" required /></Field>
                    <Field label={t.products.stock}><input name="stock" type="number" min="0" step="1" required /></Field>
                  </div>
                  <button className="button outline small" type="submit">{t.products.addVariantButton}</button>
                </form>
              </details>
            </div>
          </div>
        </div>
      </div>
    </details>
  )
}
