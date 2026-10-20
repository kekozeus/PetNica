import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import brandIcon from '../../assets/icon.png'
import { apiRequest, imageUrl, money } from '../../lib/api.js'
import { useLanguage } from '../../lib/useLanguage.js'
import { adminTranslations } from './admin.js'
import './admin.css'

const dateTime = (value, locale) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

function Field({ label, children }) { return <label>{label}{children}</label> }
function StatusSelect({ values, value, onChange, className, name }) { return (
  <select 
    className={className} 
    name={name} 
    value={value} 
    onChange={onChange}
  >
    {Object.entries(values).map(([key, label]) => 
      <option key={key} value={key}>
        {label}
      </option>
    )}
  </select> )}

export default function AdminPanel() {
  const { language, setLanguage, t, locale } = useLanguage(adminTranslations)
  const orderStatuses = { 
    pendiente: t.states.pending, 
    confirmado: t.states.confirmed, 
    preparando: t.states.preparing, 
    en_camino: t.states.onTheWay, 
    entregado: t.states.delivered, 
    cancelado: t.states.canceled 
  }
  const paymentStatuses = { 
    pendiente: t.states.pending, 
    verificado: t.states.verified, 
    rechazado: t.states.rejected 
  }
  useEffect(() => {
    document.documentElement.lang = language
    document.title = t.documentTitle
  }, [language, t.documentTitle])
  const csrf = useRef('')
  const [email, setEmail] = useState('')
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [message, setMessage] = useState({ text: '', error: false })
  const [tab, setTab] = useState('products')
  const [busy, setBusy] = useState(false)
  const request = useCallback(async (url, options = {}) => {
    try { return await apiRequest(url, options, csrf.current) }
    catch (error) { if (error.message === 'Inicia sesión para continuar.') { csrf.current = ''; setEmail(''); setOverview(null) } throw error }
  }, [])
  const notify = useCallback((text, error = false) => { setMessage({ text, error }); if (text) setTimeout(() => setMessage({ text: '', error: false }), 5000) }, [])
  const refresh = useCallback(async () => { const result = await request('/api/admin/overview'); setOverview(result) }, [request])

  useEffect(() => {
    let mounted = true
    apiRequest('/api/admin/session').then(async (session) => {
      if (!mounted) return
      if (!session.authenticated) { setLoading(false); return }
      csrf.current = session.csrfToken || ''
      setEmail(session.email)
      await refresh()
    }).catch((error) => { if (mounted) setLoginError(error.message) }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [refresh, request])

  async function login(event) {
    event.preventDefault(); setBusy(true); setLoginError('')
    const form = event.currentTarget
    const data = new FormData(form)
    try { const session = await request('/api/admin/login', { 
      method: 'POST', 
      body: { email: data.get('email'), 
        password: data.get('password') } }); 
        csrf.current = session.csrfToken || ''; 
        setEmail(session.email); 
        await refresh(); 
        form.reset() }
    catch (error) { setLoginError(error.message) } finally { setBusy(false) }
  }
  async function logout() {
    try { await request('/api/admin/logout', 
      { method: 'POST' }); 
      csrf.current = ''; 
      setEmail(''); 
      setOverview(null); 
      setLoginError('') }
    catch (error) { notify(error.message, true) }
  }
  async function createProduct(event) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form)
    try { await request('/api/admin/products', { 
      method: 'POST', 
      body: Object.fromEntries([
        'name', 
        'slug', 
        'description', 
        'categoryId', 
        'species', 
        'sku', 
        'presentation', 
        'price', 
        'stock'].map((key) => [key, values.get(key)])) }); 
      form.reset(); 
      await refresh(); 
      notify(t.messages.created) }
    catch (error) { notify(error.message, true) }
  }
  async function updateProduct(event, product) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    try { await request(`/api/admin/products/${product.id}`, { 
      method: 'PUT', 
      body: { 
        name: data.get('name'), 
        slug: data.get('slug'), 
        description: data.get('description'), 
        categoryId: data.get('categoryId'), 
        species: data.get('species'), 
        active: data.has('active') 
      } 
    }); await refresh(); notify(t.messages.updated) }
    catch (error) { notify(error.message, true) }
  }
  async function updateVariant(event, variant) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    try { await request(`/api/admin/variants/${variant.id}`, { 
      method: 'PUT', 
      body: { sku: data.get('sku'), 
        presentation: data.get('presentation'), 
        price: data.get('price'), 
        stock: data.get('stock'), 
        active: data.has('active') } }); 
        await refresh(); notify(t.messages.variantUpdated) }
    catch (error) { notify(error.message, true) }
  }
  async function createVariant(event, product) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    try { await request(`/api/admin/products/${product.id}/variants`, { 
      method: 'POST', 
      body: { 
        sku: data.get('sku'), 
        presentation: data.get('presentation'), 
        price: data.get('price'), 
        stock: data.get('stock') 
      } 
    }); form.reset(); await refresh(); notify(t.messages.variantAdded) }
    catch (error) { notify(error.message, true) }
  }
  async function uploadImage(event, product) {
    event.preventDefault(); const file = new FormData(event.currentTarget).get('image')
    if (!file?.size) return
    const data = new FormData(); data.append('image', file)
    try { await request(`/api/admin/products/${product.id}/image`, 
      {  
        method: 'POST', 
        body: data 
      }); 
    await refresh(); notify(t.messages.imageUpdated) }
    catch (error) { notify(error.message, true) }
  }
  async function removeImage(product) {
    try { await request(`/api/admin/products/${product.id}/image`, { 
      method: 'DELETE' }); 
      await refresh(); 
      notify(t.messages.imageRemoved) }
    catch (error) { notify(error.message, true) }
  }
  async function changeOrder(order, field, value) {
    const endpoint = field === 'status' ? 'status' : 'payment'
    try { await request(`/api/admin/orders/${order.id}/${endpoint}`, { 
      method: 'PUT', 
      body: { status: value } 
    }); await refresh(); notify(field === 'status' ? t.messages.orderUpdated : t.messages.paymentUpdated) }
    catch (error) { notify(error.message, true); await refresh() }
  }

  if (loading) return (
    <motion.main className="wrap empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{t.messages.loading}</motion.main>
  )
  return <>
    <header className="admin-header">
      <Link className="logo brand-logo" to="/" aria-label={t.brand}><span className="brand-logo-frame"><img src={brandIcon} alt="" width="1408" height="768" /></span></Link>
      <label className="language-picker"><span className="visually-hidden">{t.language}</span><select aria-label={t.language} value={language} onChange={(event) => setLanguage(event.target.value)}><option value="es">{t.spanish}</option><option value="en">{t.english}</option></select></label>
      <Link className="back-link" to="/">{t.back}</Link>
    </header>
    <main className="admin-main">
      {!overview ? 
      <motion.section className="login-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <span className="eyebrow">{t.login.eyebrow}</span>
        <h1>{t.login.title}</h1>
          <p>{t.login.description}</p>
          <form onSubmit={login}>
            <Field label={t.login.email}>
              <input name="email" type="email" autoComplete="username" maxLength="150" required />
            </Field>
            
            <Field label={t.login.password}>
              <input name="password" type="password" autoComplete="current-password" required />
            </Field>
            {loginError && <p className="message error" role="alert">{loginError}</p>}
            
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? t.login.loading : t.login.submit}
            </button>
          </form>
          
          <small>{t.login.initialAccount}</small>
      </motion.section> : 
      
      <>
        <div className="welcome">
          <div>
            <span className="eyebrow">{t.panel.eyebrow}</span>
            <h1>{t.panel.title}</h1>
            <p>{t.messages.sessionStarted.replace('{email}', email)}</p>
            </div>
            <button className="button outline" type="button" onClick={logout}>
              {t.panel.logout}
            </button>
          </div>
        <nav className="tabs" aria-label={t.panel.tabsAria}>
          <button type="button" aria-pressed={tab === 'products'} onClick={() => setTab('products')}>
            {t.panel.productsTab}
          </button>
          <button type="button" aria-pressed={tab === 'orders'} onClick={() => setTab('orders')}>
            {t.panel.ordersTab}
          </button>
        </nav>
        {message.text && 
          <p className={`message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
        {tab === 'products' ? 
          <section className="tab-panel">
            <div className="section-title">
              <div>
                <span className="eyebrow">{t.products.eyebrow}</span>
                <h2>{t.products.title}</h2>
              </div>
              <span className="count-pill">
                {overview.products.length}
              </span>
            </div>
              <details className="create-box">
                <summary>{t.products.add}</summary>
                
                <form className="product-form" onSubmit={createProduct}>
                  <div className="form-grid">
                    <Field label={t.products.name}>
                      <input name="name" maxLength="150" required />
                    </Field>
                    
                    <Field label={t.products.slug}>
                      <input name="slug" maxLength="160" placeholder={t.products.slugPlaceholder} /> 
                    </Field>
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
                    <Field label={t.products.initialPresentation}>
                      <input name="presentation" maxLength="60" placeholder={t.products.initialPlaceholder} required />
                    </Field>
                    <Field label={t.products.sku}>
                      <input name="sku" maxLength="40" required />
                    </Field>
                    <Field label={t.products.price}>
                      <input name="price" type="number" min="0" step="0.01" required />
                    </Field>
                    <Field label={t.products.stock}>
                      <input name="stock" type="number" min="0" step="1" required />
                    </Field>
                  </div>
                  <Field label={t.products.description}>
                    <textarea name="description" maxLength="5000" rows="2" />
                  </Field>
                  <button className="button primary" type="submit">{t.products.create}</button>
                </form>
              </details>
          <div className="product-list">{overview.products.length ? overview.products.map((product) => <article className="product-card" key={product.id}><div className="product-heading"><div><h3>{product.name}</h3><small>{product.category} · {product.variants.length} {t.products.variants}</small></div><span className="count-pill">{product.active ? t.products.active : t.products.hidden}</span></div><div className="product-grid"><div><div className="product-image">{imageUrl(product.image) ? <img src={imageUrl(product.image)} alt={product.name} /> : t.products.noImage}</div><form className="product-image-form" onSubmit={(event) => uploadImage(event, product)}><Field label={t.products.replaceImage}><input name="image" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" required /></Field><button className="button outline small" type="submit">{t.products.uploadImage}</button>{product.image?.startsWith('/images/admin-') && <button className="button danger small" type="button" onClick={() => removeImage(product)}>{t.products.removeImage}</button>}</form></div><div><form className="product-edit" onSubmit={(event) => updateProduct(event, product)}><div className="product-fields"><Field label={t.products.name}><input name="name" maxLength="150" defaultValue={product.name} required /></Field><Field label={t.products.slug}><input name="slug" maxLength="160" defaultValue={product.slug} required /></Field><Field label={t.products.category}><select name="categoryId" defaultValue={product.categoryId}>{overview.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label={t.products.for}><select name="species" defaultValue={product.species}><option value="perro">{t.products.dog}</option><option value="gato">{t.products.cat}</option><option value="ambos">{t.products.both}</option></select></Field><label className="active-check"><input name="active" type="checkbox" defaultChecked={product.active} /> {t.products.visible}</label></div><Field label={t.products.description}><textarea name="description" maxLength="5000" rows="2" defaultValue={product.description || ''} /></Field><button className="button outline small" type="submit">{t.products.saveProduct}</button></form><div className="variant-list"><b>{t.products.inventory}</b>{product.variants.length ? product.variants.map((variant) => <form className="variant-row" key={variant.id} onSubmit={(event) => updateVariant(event, variant)}><Field label={t.products.sku}><input name="sku" maxLength="40" defaultValue={variant.sku} required /></Field><Field label={t.products.presentation}><input name="presentation" maxLength="60" defaultValue={variant.presentation} required /></Field><Field label={t.products.variantPrice}><input name="price" type="number" min="0" step="0.01" defaultValue={variant.price} required /></Field><Field label={t.products.stock}><input name="stock" type="number" min="0" step="1" defaultValue={variant.stock} required /></Field><label className="active-check"><input name="active" type="checkbox" defaultChecked={variant.active} /> {t.products.active}</label><button className="button outline small" type="submit">{t.products.save}</button></form>) : <p className="help-text">{t.products.noVariants}</p>}<details><summary>{t.products.addVariant}</summary><form className="variant-create" onSubmit={(event) => createVariant(event, product)}><div className="form-grid"><Field label={t.products.sku}><input name="sku" maxLength="40" required /></Field><Field label={t.products.presentation}><input name="presentation" maxLength="60" required /></Field><Field label={t.products.variantPrice}><input name="price" type="number" min="0" step="0.01" required /></Field><Field label={t.products.stock}><input name="stock" type="number" min="0" step="1" required /></Field></div><button className="button outline small" type="submit">{t.products.addVariantButton}</button></form></details></div></div></div></article>) : <p className="empty">{t.products.empty}</p>}</div>
        </section> : 
          <section className="tab-panel">
            <div className="section-title">
              <div>
                <span className="eyebrow">{t.orders.eyebrow}</span>
                <h2>{t.orders.title}</h2>
              </div>
              <span className="count-pill">{overview.orders.length}</span>
            </div>
            <p className="help-text">{t.orders.help}</p>
            <div className="order-list">
              {overview.orders.length ? overview.orders.map((order) => (
                <article className="order-card" key={order.id}>
                  <div className="order-heading">
                    <div>
                      <h3>{t.orders.order} #{order.id} · {money(order.total, locale)}</h3>
                      <span className="order-meta">{order.firstName} {order.lastName} · {order.email}</span>
                    </div>
                    <time>{dateTime(order.createdAt, locale)}</time>
                  </div>
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
                  <div className="order-actions">
                    <Field label={t.orders.status}>
                      <StatusSelect 
                        className="order-status" 
                        name="status" 
                        values={orderStatuses} 
                        value={order.status} 
                        onChange={(event) => changeOrder(order, 'status', event.target.value)} 
                      />
                    </Field>
                    {order.paymentMethod === 'transferencia' ? (
                      <Field label={t.orders.paymentStatus}>
                        <StatusSelect 
                          className="payment-status" 
                          name="paymentStatus" 
                          values={paymentStatuses} 
                          value={order.paymentStatus} 
                          onChange={(event) => changeOrder(order, 'payment', event.target.value)} 
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
                </article>
              )) : <p className="empty">{t.orders.empty}</p>}
            </div>
          </section>
          }
      </>}
    </main>
    <footer>
      <span>{t.messages.secureFooter}</span>
      <Link to="/">{t.messages.goToStore}</Link>
    </footer>
  </>
}
