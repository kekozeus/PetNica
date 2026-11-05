import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

import { siteConfig } from '../../config/site.ts'
import { apiRequest, money } from '../../lib/api.js'
import { useLanguage } from '../../lib/useLanguage.js'
import { storeTranslations } from '../../features/store/store.js'
import './store.css'

import AccountDialog from '../../components/store/AccountDialog.jsx'
import CartDrawer from '../../components/store/CartDrawer.jsx'
import HeroSection from '../../components/store/HeroSection.jsx'
import HowSection from '../../components/store/HowSection.jsx'
import PetboxSection from '../../components/store/PetboxSection.jsx'
import ProductDialog from '../../components/store/ProductDialog.jsx'
import ShopSection from '../../components/store/ShopSection.jsx'
import StoreFooter from '../../components/store/StoreFooter.jsx'
import StoreHeader from '../../components/store/StoreHeader.jsx'
import TrustRow from '../../components/store/TrustRow.jsx'

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

export default function Storefront() {
  const { language, setLanguage, t, locale } = useLanguage(storeTranslations)
  const formatMoney = (value) => money(value, locale)
  const homeSeoTitle = siteConfig.seo.pages.find((page) => page.path === '/')?.title

  useEffect(() => {
    document.documentElement.lang = language
    document.title = language === 'es' ? homeSeoTitle || t.documentTitle : t.documentTitle
  }, [homeSeoTitle, language, t.documentTitle])

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
  const [adminSession, setAdminSession] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [orders, setOrders] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [productDetails, setProductDetails] = useState(null)
  const [activeProduct, setActiveProduct] = useState(null)
  const activeProductRef = useRef(null)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [promo, setPromo] = useState(false)
  const [promoEligible, setPromoEligible] = useState(true)
  const [termsAccepted, setTermsAccepted] = useState(() => {
    try {
      return localStorage.getItem('petnica.termsAccepted') === 'true'
    } catch {
      return false
    }
  })
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
    try {
      localStorage.setItem('petnica.cart', JSON.stringify({
        owner: customer?.id || cartOwner,
        pending: cartPending,
        items: cartRef.current
      }))
    } catch {
      setAccountError(t.errors.localCart)
    }
  }, [cartHydrated, customer, cartOwner, cartPending, t])

  const accountRequest = useCallback((url, options = {}) => apiRequest(url, options, csrfRef.current), [])

  const refreshSession = useCallback(async () => {
    try {
      const session = await accountRequest('/api/account/session')
      csrfRef.current = session.csrfToken || ''
      setCsrfToken(session.csrfToken || '')
      const nextCustomer = session.authenticated ? session.customer : null
      customerRef.current = nextCustomer
      setCustomer(nextCustomer)
      setAdminSession(Boolean(session.adminSession))
      setPromoEligible(!session.authenticated || session.promoEligible !== false)
    } catch {}
  }, [accountRequest])

  const syncCart = useCallback(async () => {
    if (!customer || !cartHydrated) return
    const revision = cartRevision.current
    const petbox = cartRef.current.find((line) => line.isPetbox)
    const body = {
      items: cartRef.current.filter((line) => !line.isPetbox).map(({ variantId, quantity }) => ({ variantId, quantity })),
      petbox: petbox ? { planId: petbox.planId, petName: petbox.petName || null, size: petbox.size || null } : null
    }
    try {
      await accountRequest('/api/account/cart', { method: 'PUT', body })
      if (revision === cartRevision.current) { setCartPending(false); persistCart() }
    } catch {
      setCartPending(true)
      persistCart()
      setAccountError(t.errors.syncCart)
    }
  }, [accountRequest, cartHydrated, customer, persistCart, t])

  const scheduleSync = useCallback(() => {
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => syncCart(), 250)
  }, [syncCart])

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
      if (product && variant && Number(variant.stock) > 0) {
        merged.set(String(variant.id), {
          id: String(variant.id),
          variantId: String(variant.id),
          name: product.name,
          presentation: variant.presentation,
          price: Number(variant.price),
          stock: Number(variant.stock),
          quantity: Math.min(Number(saved.quantity), Number(variant.stock), 99)
        })
      }
    }

    for (const line of guestCart.filter((item) => !item.isPetbox)) {
      const product = catalog.products.find((item) => item.variants.some((variant) => String(variant.id) === String(line.variantId)))
      const variant = product?.variants.find((item) => String(item.id) === String(line.variantId))
      if (!product || !variant || Number(variant.stock) < 1) continue
      const existing = merged.get(String(variant.id))
      if (existing) {
        existing.quantity = Math.min(Number(variant.stock), existing.quantity + line.quantity)
      } else {
        merged.set(String(variant.id), { ...line, stock: Number(variant.stock), price: Number(variant.price), quantity: Math.min(line.quantity, Number(variant.stock)) })
      }
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
          setAdminSession(Boolean(session.adminSession))
          setPromoEligible(!session.authenticated || session.promoEligible !== false)
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
        } else {
          cartHydratedRef.current = true
          setCartHydrated(true)
        }
      } catch (error) {
        if (alive) setCatalogError(error.message)
      }
    }

    initialize()
    return () => { alive = false; clearTimeout(syncTimer.current) }
  }, [accountRequest, setCart])

  const selectVariant = useCallback((productId, variantId) => {
    setCatalog((current) => ({ ...current, products: current.products.map((item) => String(item.id) === String(productId) ? { ...item, selectedVariantId: String(variantId) } : item) }))
  }, [])

  function addProduct(product, variant) {
    if (!variant || Number(variant.stock) < 1) return

    setOrderSuccess(null)
    setOrderError('')
    setCart((lines) => {
      const line = lines.find((item) => item.variantId === String(variant.id))
      if (line) return lines.map((item) => item === line ? { ...item, quantity: Math.min(Number(variant.stock), item.quantity + 1) } : item)
      return [...lines, { id: String(variant.id), variantId: String(variant.id), name: product.name, presentation: variant.presentation, price: Number(variant.price), stock: Number(variant.stock), quantity: 1 }]
    })
    activeProductRef.current = null
    setActiveProduct(null)
    setProductDetails(null)
    setCartOpen(true)
  }

  function addPetbox() {
    if (!selectedPlan) return

    setOrderSuccess(null)
    setOrderError('')
    setCart((lines) => {
      const existing = lines.find((line) => line.isPetbox)
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
      }
      return [...lines.filter((item) => !item.isPetbox), line]
    })
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

  const loadOrders = useCallback(async () => {
    try {
      const result = await accountRequest('/api/account/orders')
      setOrders(result.orders)
    } catch (error) {
      setOrders([])
      setAccountError(error.message)
    }
  }, [accountRequest])

  async function handleAuth(result) {
    const nextCustomer = result.customer
    customerRef.current = nextCustomer
    setCustomer(nextCustomer)
    if (result.csrfToken) { csrfRef.current = result.csrfToken; setCsrfToken(result.csrfToken) }
    setPromoEligible(result.promoEligible !== false)
    if (result.promoEligible === undefined) {
      try {
        const session = await accountRequest('/api/account/session')
        setPromoEligible(session.promoEligible !== false)
      } catch {}
    }

    try {
      const saved = await accountRequest('/api/account/cart')
      mergeServerCart(saved)
    } catch {
      setCartHydrated(true)
      setAccountError(t.errors.cartRestore)
    }

    setAccountOpen(true)
    if (activeProduct) {
      try {
        const detail = await apiRequest(`/api/products/${encodeURIComponent(activeProduct)}`)
        setProductDetails(detail)
      } catch {}
    }
  }

  function openAccount() {
    setAccountError('')
    setOrders(customer ? null : [])
    setAccountOpen(true)
  }

  const handleTermsAccept = useCallback((remember) => {
    setTermsAccepted(remember)
    try {
      if (remember) localStorage.setItem('petnica.termsAccepted', 'true')
      else localStorage.removeItem('petnica.termsAccepted')
    } catch {}
  }, [])

  useEffect(() => {
    if (!promoEligible) setPromo(false)
  }, [promoEligible])

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

    let nextCsrf = ''
    try {
      const result = await accountRequest('/api/account/logout', { method: 'POST' })
      nextCsrf = result?.csrfToken || ''
    } catch (error) {
      if (error.status !== 401) return setAccountError(error.message)
    }

    csrfRef.current = nextCsrf
    setCsrfToken(nextCsrf)
    customerRef.current = null
    setCustomer(null)
    setCartHydrated(true)
    setCartPending(false)
    setCartOwner(null)
    setOrders([])
    setAccountError(warning)
  }

  async function submitOrder(payload) {
    if (!customer) { openAccount(); return }

    setLoadingOrder(true)
    setOrderError('')
    setOrderSuccess(null)

    const petbox = cart.find((line) => line.isPetbox)
    const body = {
      ...payload,
      items: cart.filter((line) => !line.isPetbox).map(({ variantId, quantity }) => ({ variantId, quantity })),
      petbox: petbox ? { planId: petbox.planId, petName: payload.petName, size: petbox.species === 'perro' ? (payload.petSize || petbox.size) : null } : null
    }

    try {
      let result
      try {
        result = await accountRequest('/api/orders', { method: 'POST', body })
      } catch (error) {
        if (error.status !== 403) throw error
        await refreshSession()
        result = await accountRequest('/api/orders', { method: 'POST', body })
      }
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
      setCart([])
      setPromo(false)
      setPromoEligible(false)
      if (accountOpen) loadOrders()
    } catch (error) {
      if (error.status === 403) refreshSession()
      setOrderError(error.message)
    } finally {
      setLoadingOrder(false)
    }
  }

  function printInvoice(order) {
    const popup = window.open('', '_blank')
    if (!popup) return setAccountError(t.order.popupBlocked)
    popup.opener = null
    const productSubtotal = order.items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0)
    const rows = order.items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.quantity)}</td><td>${formatMoney(item.unitPrice)}</td><td>${formatMoney(Number(item.unitPrice) * Number(item.quantity))}</td></tr>`).join('') + (order.petboxName ? `<tr><td>${escapeHtml(order.petboxName)}${escapeHtml(t.order.petboxSubscription)}</td><td>1</td><td>${formatMoney(Number(order.subtotal) - productSubtotal)}</td><td>${formatMoney(Number(order.subtotal) - productSubtotal)}</td></tr>` : '')
    popup.document.write(`<!doctype html><html lang="${language}"><meta charset="utf-8"><title>${escapeHtml(t.order.invoiceTitle)} PetNica #${escapeHtml(order.id)}</title><style>body{font:15px/1.5 Arial,sans-serif;color:#173d3b;max-width:760px;margin:36px auto;padding:0 22px}h1{color:#148d80}table{width:100%;border-collapse:collapse;margin-top:15px}td,th{padding:10px 7px;border-bottom:1px solid #d9e8e5;text-align:left}</style><h1>PetNica</h1><p>${escapeHtml(t.order.invoiceTitle)} #${escapeHtml(order.id)}</p><p>${escapeHtml(order.firstName)} ${escapeHtml(order.lastName)} · ${escapeHtml(order.email)}</p><p>${escapeHtml(order.shippingAddress)}</p><table><thead><tr><th>${escapeHtml(t.order.item)}</th><th>${escapeHtml(t.order.quantity)}</th><th>${escapeHtml(t.order.price)}</th><th>${escapeHtml(t.order.total)}</th></tr></thead><tbody>${rows}</tbody></table><p>${escapeHtml(t.address.subtotal)} ${formatMoney(order.subtotal)} · ${escapeHtml(t.address.discount)} − ${formatMoney(order.discount)} · ${escapeHtml(t.address.shipping)} ${formatMoney(order.shipping)}</p><h2>${escapeHtml(t.order.total)}: ${formatMoney(order.total)}</h2><button type="button" id="print-invoice">${escapeHtml(t.order.print)}</button><p>${escapeHtml(t.order.note)}</p></html>`)
    popup.document.close()
    const printButton = popup.document.getElementById('print-invoice')
    if (printButton) printButton.onclick = () => popup.print()
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
      const body = {
        items: cartRef.current.filter((line) => !line.isPetbox).map(({ variantId, quantity }) => ({ variantId, quantity })),
        petbox: petbox ? { planId: petbox.planId, petName: petbox.petName || null, size: petbox.size || null } : null
      }
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

  return (
    <>
      <StoreHeader
        t={t}
        language={language}
        setLanguage={setLanguage}
        customer={customer}
        showPromo={promoEligible}
        cartCount={cart.reduce((sum, line) => sum + line.quantity, 0)}
        onOpenAccount={openAccount}
        onOpenCart={() => setCartOpen(true)}
      />

      <main id="top" className="wrap">
        <HeroSection
          t={t}
          species={species}
          onSelectSpecies={(kind) => { setSpecies(kind); setCategory('Todo') }}
          catalogError={catalogError}
          prefersReducedMotion={prefersReducedMotion}
        />

        <TrustRow t={t} />

        <ShopSection
          t={t}
          species={species}
          categories={categories}
          category={category}
          onSelectCategory={setCategory}
          catalogError={catalogError}
          products={products}
          catalogProductCount={catalog.products.length}
          onOpen={openProduct}
          onAdd={addProduct}
          onSelectVariant={selectVariant}
          prefersReducedMotion={prefersReducedMotion}
          formatMoney={formatMoney}
        />

        <PetboxSection
          t={t}
          plans={plans}
          selectedPlan={selectedPlan}
          onSelectPlan={setSelectedPlanId}
          onAdd={addPetbox}
          formatMoney={formatMoney}
        />

        <HowSection t={t} />
      </main>

      <StoreFooter t={t} language={language} year={year} whatsapp={catalog.whatsapp} />

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
        promoEligible={promoEligible}
        termsAccepted={termsAccepted}
        onTermsAccept={handleTermsAccept}
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
        adminSession={adminSession}
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
  )
}
