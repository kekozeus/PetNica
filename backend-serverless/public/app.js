const COPY = {
  perro: {
    lead: "Alimento, juguetes y accesorios para perros de todos los tamaños, directo a tu puerta.",
    title: "Lo que necesita tu perro",
    emoji: "🐶",
  },
  gato: {
    lead: "Arena, rascadores y snacks para gatos que mandan en casa, directo a tu puerta.",
    title: "Lo que necesita tu gato",
    emoji: "🐱",
  },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `C$ ${Number(value).toLocaleString("es-NI", { maximumFractionDigits: 2 })}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function readSavedCart() {
  try {
    const saved = JSON.parse(localStorage.getItem("petnica.cart") || "[]");
    const items = Array.isArray(saved) ? saved : saved?.items;
    if (!Array.isArray(items)) return { items: [], owner: null };
    return {
      items: items.filter((line) => line && (
      (typeof line.variantId === "string" && Number.isInteger(line.quantity) && line.quantity > 0)
      || (line.isPetbox && typeof line.planId === "string")
      )),
      owner: Array.isArray(saved) ? null : saved.owner || null,
      pending: !Array.isArray(saved) && Boolean(saved.pending),
    };
  } catch (error) {
    console.error("No se pudo recuperar el carrito guardado en este navegador:", error);
    return { items: [], owner: null };
  }
}

const savedCart = readSavedCart();
let persistedCartOwner = savedCart.owner;
let cartSyncPending = savedCart.pending;
const state = {
  species: "perro",
  category: "Todo",
  products: [],
  categories: [],
  plans: [],
  zones: [],
  cart: savedCart.items,
  selectedPlan: null,
  promo: false,
  whatsapp: "",
  orderCreated: false,
  customer: null,
  csrfToken: "",
  googleConfigured: false,
  activeProductId: null,
  cartHydrated: false,
  cartSyncTimer: null,
  cartRevision: 0,
  orders: [],
};

function imageUrl(value) {
  if (typeof value !== "string") return "";
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

async function accountRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = (options.method || "GET").toUpperCase();
  if (options.body) {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && state.csrfToken) {
    headers.set("X-CSRF-Token", state.csrfToken);
  }
  const response = await fetch(url, { ...options, method, headers });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
  if (result.csrfToken) state.csrfToken = result.csrfToken;
  return result;
}

function persistLocalCart(cartChanged = false, ownerOverride = undefined) {
  if (!state.cartHydrated) return;
  try {
    if (cartChanged) {
      state.cartRevision += 1;
      if (state.customer) cartSyncPending = true;
    }
    if (ownerOverride !== undefined) persistedCartOwner = ownerOverride;
    else if (state.customer) persistedCartOwner = state.customer.id;
    else if (cartChanged) persistedCartOwner = null;
    localStorage.setItem("petnica.cart", JSON.stringify({
      owner: persistedCartOwner,
      pending: cartSyncPending,
      items: state.cart,
    }));
  } catch (error) {
    console.error("No se pudo guardar el carrito en este navegador:", error);
    showAccountError("El navegador no pudo guardar el carrito localmente. Inicia sesión para conservarlo en tu cuenta.");
  }
}

function cartPayload() {
  const petbox = state.cart.find((line) => line.isPetbox);
  return {
    items: state.cart.filter((line) => !line.isPetbox)
      .map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
    petbox: petbox ? {
      planId: petbox.planId,
      petName: petbox.petName || null,
      size: petbox.size || null,
    } : null,
  };
}

function scheduleAccountCartSave() {
  if (!state.customer || !state.cartHydrated) return;
  window.clearTimeout(state.cartSyncTimer);
  const revision = state.cartRevision;
  const customerId = state.customer.id;
  state.cartSyncTimer = window.setTimeout(async () => {
    try {
      await accountRequest("/api/account/cart", { method: "PUT", body: cartPayload() });
      if (state.customer?.id !== customerId) return;
      if (revision === state.cartRevision) {
        cartSyncPending = false;
        persistLocalCart(false, customerId);
      } else {
        scheduleAccountCartSave();
      }
    } catch (error) {
      if (state.customer?.id !== customerId) return;
      console.error("No se pudo sincronizar el carrito con la cuenta:", error);
      cartSyncPending = true;
      persistLocalCart(false, customerId);
      showAccountError("No se pudo sincronizar el carrito con tu cuenta. Revisa tu conexión e inténtalo otra vez.");
    }
  }, 250);
}

function productLineForVariant(variantId, quantity) {
  for (const product of state.products) {
    const variant = product.variants.find((item) => String(item.id) === String(variantId));
    if (!variant || Number(variant.stock) < 1) continue;
    return {
      id: String(variant.id),
      variantId: String(variant.id),
      name: product.name,
      presentation: variant.presentation,
      price: Number(variant.price),
      stock: Number(variant.stock),
      quantity: Math.min(Number(quantity), Number(variant.stock), 99),
    };
  }
  return null;
}

function petboxLineForPlan(planId, petName = null) {
  const plan = state.plans.find((item) => String(item.id) === String(planId));
  if (!plan) return null;
  return {
    id: "petbox",
    isPetbox: true,
    planId: String(plan.id),
    species: plan.species,
    size: plan.size,
    name: plan.name,
    price: Number(plan.price),
    quantity: 1,
    petName: petName || null,
  };
}

function mergeSavedCart(serverCart) {
  const localOwnedByCustomer = state.customer?.id === persistedCartOwner;
  const localIsPending = localOwnedByCustomer && cartSyncPending;
  const guestCart = localOwnedByCustomer && !localIsPending ? [] : state.cart;
  const merged = new Map();
  if (!localIsPending) {
    for (const item of serverCart.items || []) {
      const line = productLineForVariant(item.variantId, Number(item.quantity));
      if (line) merged.set(line.variantId, line);
    }
  }
  for (const item of guestCart.filter((line) => !line.isPetbox)) {
    const line = productLineForVariant(item.variantId, Number(item.quantity));
    if (!line) continue;
    const saved = merged.get(line.variantId);
    if (saved) saved.quantity = Math.min(saved.stock, saved.quantity + line.quantity);
    else merged.set(line.variantId, line);
  }
  const guestPetbox = guestCart.find((line) => line.isPetbox);
  const petbox = petboxLineForPlan(
    guestPetbox?.planId || (!localIsPending && serverCart.petbox?.planId),
    guestPetbox?.petName || (!localIsPending && serverCart.petbox?.petName),
  );
  state.cart = [...merged.values(), ...(petbox ? [petbox] : [])];
  if (state.customer) {
    persistedCartOwner = state.customer.id;
    cartSyncPending = true;
  }
  state.cartHydrated = true;
  persistLocalCart();
  renderCart();
  scheduleAccountCartSave();
}

function fillCheckoutProfile(customer) {
  const checkout = $("#checkout");
  for (const name of ["firstName", "lastName", "email"]) {
    const input = checkout.elements.namedItem(name);
    input.value = customer?.[name] || "";
    input.readOnly = Boolean(customer);
  }
  checkout.elements.namedItem("phone").value = customer?.phone || "";
}

function updateCheckoutAccountRequirement() {
  const authenticated = Boolean(state.customer);
  $("#checkoutAccountNote").hidden = authenticated;
  $("#submitOrder").disabled = !authenticated || state.cart.length === 0 || state.orderCreated;
}

function showAccountError(message) {
  const error = $("#accountError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function matchingPlans() {
  return state.plans.filter((plan) => plan.species === state.species);
}

function availableProducts() {
  return state.products.filter((product) =>
    (product.species === state.species || product.species === "ambos")
    && (state.category === "Todo" || product.category === state.category),
  );
}

function selectedVariant(product, selector) {
  const variantId = selector?.value || String(product.variants[0]?.id || "");
  return product.variants.find((variant) => String(variant.id) === variantId);
}

function setSpecies(species) {
  state.species = species;
  state.category = "Todo";
  $$(".pick button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.species === species));
  });
  $("#lead").textContent = COPY[species].lead;
  $("#tTitle").textContent = COPY[species].title;
  $("#stageEm").textContent = COPY[species].emoji;
  const heroImage = $("#stage img");
  heroImage.hidden = false;
  $("#stageEm").hidden = true;
  heroImage.src = `/images/hero-${species}.png`;
  heroImage.onerror = () => {
    heroImage.hidden = true;
    $("#stageEm").hidden = false;
  };
  const plans = matchingPlans();
  if (!plans.some((plan) => String(plan.id) === String(state.selectedPlan?.id))) {
    state.selectedPlan = plans[0] || null;
  }
  renderCategories();
  renderProducts();
  renderPlans();
}

function renderCategories() {
  const categories = ["Todo", ...state.categories.map((category) => category.name)];
  $("#chips").innerHTML = categories.map((category) => `
    <button type="button" aria-pressed="${category === state.category}" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)}
    </button>
  `).join("");
  $$("#chips button").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  const products = availableProducts();
  $("#grid").innerHTML = products.length ? products.map((product) => {
    const firstVariant = product.variants[0];
    const outOfStock = product.variants.every((variant) => Number(variant.stock) < 1);
    const variantOptions = product.variants.map((variant) => `
      <option value="${escapeHtml(variant.id)}" ${variant.id === firstVariant.id ? "selected" : ""}
        ${Number(variant.stock) < 1 ? "disabled" : ""}>
        ${escapeHtml(variant.presentation)}${Number(variant.stock) < 1 ? " · Agotado" : ""}
      </option>
    `).join("");
    const src = imageUrl(product.image);
    const image = src
      ? `<img src="${escapeHtml(src)}" alt="" loading="lazy"
          onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
      : "";
    return `
      <article class="card" data-product="${escapeHtml(product.id)}">
        <button class="product-photo product-open" type="button" aria-label="Ver detalles de ${escapeHtml(product.name)}">
          ${image}<span class="emoji" ${src ? "hidden" : ""} aria-hidden="true">🐾</span>
        </button>
        <h3>${escapeHtml(product.name)}</h3>
        <div class="card-rating">${ratingSummaryMarkup(product.rating, product.reviewCount)}</div>
        <p class="description">${escapeHtml(product.description || product.category)}</p>
        <label class="visually-hidden" for="variant-${escapeHtml(product.id)}">Presentación de ${escapeHtml(product.name)}</label>
        <select id="variant-${escapeHtml(product.id)}" class="variant-select" ${product.variants.length === 1 ? "hidden" : ""}>
          ${variantOptions}
        </select>
        <button class="product-details-link" type="button">Ver detalles y opiniones <span aria-hidden="true">→</span></button>
        <div class="row">
          <span class="price">${money(firstVariant?.price || 0)}</span>
          <button class="btn add-product" type="button" ${outOfStock ? "disabled" : ""}>
            ${outOfStock ? "Agotado" : "Agregar"}
          </button>
        </div>
        <small class="stock">${outOfStock ? "Sin existencias por el momento" : `Disponible · ${Number(firstVariant.stock)} en stock`}</small>
      </article>
    `;
  }).join("") : '<p class="empty">Pronto tendremos productos en esta categoría para tu mascota.</p>';

  $$(".card").forEach((card) => {
    const product = state.products.find((item) => String(item.id) === card.dataset.product);
    const selector = card.querySelector(".variant-select");
    const button = card.querySelector(".add-product");
    const price = card.querySelector(".price");
    const stock = card.querySelector(".stock");
    const updateVariant = () => {
      const variant = selectedVariant(product, selector);
      price.textContent = money(variant?.price || 0);
      stock.textContent = variant && Number(variant.stock) > 0
        ? `Disponible · ${Number(variant.stock)} en stock`
        : "Sin existencias por el momento";
      button.disabled = !variant || Number(variant.stock) < 1;
      button.textContent = button.disabled ? "Agotado" : "Agregar";
    };
    selector?.addEventListener("change", updateVariant);
    card.querySelector(".product-open").addEventListener("click", () => loadProductDetails(product.id));
    card.querySelector(".product-details-link").addEventListener("click", () => loadProductDetails(product.id));
    card.addEventListener("click", (event) => {
      if (!event.target.closest("button, select, label")) loadProductDetails(product.id);
    });
    button.addEventListener("click", () => {
      const variant = selectedVariant(product, selector);
      if (variant) addProduct(product, variant);
    });
  });
}

function starsMarkup(value, label) {
  const rating = Math.max(0, Math.min(5, Number(value) || 0));
  const filled = Math.round(rating);
  return `<span class="stars" role="img" aria-label="${escapeHtml(label || `${rating.toFixed(1)} de 5 estrellas`)}">
    ${Array.from({ length: 5 }, (_, index) => `<span class="${index < filled ? "filled" : ""}" aria-hidden="true">★</span>`).join("")}
  </span>`;
}

function ratingSummaryMarkup(rating, count) {
  const reviewCount = Number(count) || 0;
  return reviewCount
    ? `${starsMarkup(rating)} <span>${Number(rating).toFixed(1)} · ${reviewCount} ${reviewCount === 1 ? "opinión" : "opiniones"}</span>`
    : '<span class="no-rating">Aún sin opiniones</span>';
}

function formattedReviewDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("es-NI", { dateStyle: "medium" }).format(date);
}

function reviewCardsMarkup(reviews, emptyMessage) {
  return reviews.length ? reviews.map((review) => `
    <article class="review-card">
      <div class="review-card-head">
        <div>${starsMarkup(review.rating)}<b>${escapeHtml(review.customerName)}</b></div>
        <time>${escapeHtml(formattedReviewDate(review.createdAt))}</time>
      </div>
      <p>${escapeHtml(review.comment || "El cliente no agregó un comentario.")}</p>
    </article>
  `).join("") : `<p class="reviews-empty">${escapeHtml(emptyMessage)}</p>`;
}

function ratingPickerMarkup(name, label) {
  return `
    <div class="rating-field">
      <span class="rating-label">${escapeHtml(label)}</span>
      <div class="star-picker" role="radiogroup" aria-label="${escapeHtml(label)}">
        ${[1, 2, 3, 4, 5].map((rating) => `
          <button type="button" role="radio" aria-checked="false"
            aria-label="${rating} ${rating === 1 ? "estrella" : "estrellas"}"
            data-rating-group="${name}" data-rating="${rating}">★</button>
        `).join("")}
      </div>
      <input type="hidden" name="${name}" value="">
    </div>
  `;
}

function addRatingPickerBehavior(container) {
  container.querySelectorAll(".star-picker").forEach((picker) => {
    const buttons = [...picker.querySelectorAll("[role=radio]")];
    const hidden = picker.parentElement.querySelector(`input[name="${buttons[0]?.dataset.ratingGroup}"]`);
    const selectRating = (rating) => {
      hidden.value = String(rating);
      buttons.forEach((button) => {
        const value = Number(button.dataset.rating);
        button.setAttribute("aria-checked", String(value === rating));
        button.classList.toggle("selected", value <= rating);
        button.classList.remove("preview");
      });
    };
    buttons.forEach((button, index) => {
      button.addEventListener("click", () => selectRating(Number(button.dataset.rating)));
      button.addEventListener("mouseenter", () => {
        const preview = Number(button.dataset.rating);
        buttons.forEach((candidate) => candidate.classList.toggle("preview", Number(candidate.dataset.rating) <= preview));
      });
      button.addEventListener("keydown", (event) => {
        const next = event.key === "ArrowRight" || event.key === "ArrowUp" ? index + 1
          : event.key === "ArrowLeft" || event.key === "ArrowDown" ? index - 1 : index;
        if (next === index) return;
        event.preventDefault();
        const target = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
        target.focus();
        selectRating(Number(target.dataset.rating));
      });
    });
    picker.addEventListener("mouseleave", () => {
      const selected = Number(hidden.value) || 0;
      buttons.forEach((button) => button.classList.toggle("preview", Number(button.dataset.rating) <= selected));
    });
  });
}

function productDetailMarkup(details) {
  const product = details.product;
  const source = imageUrl(product.image);
  const image = source
    ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(product.name)}"
         onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
    : "";
  const variants = product.variants || [];
  const firstVariant = variants[0];
  const options = variants.map((variant) => `
    <option value="${escapeHtml(variant.id)}" ${String(variant.id) === String(firstVariant?.id) ? "selected" : ""}
      ${Number(variant.stock) < 1 ? "disabled" : ""}>
      ${escapeHtml(variant.presentation)}${Number(variant.stock) < 1 ? " · Agotado" : ""}
    </option>
  `).join("");
  const deliveryCount = Number(details.deliveryReviewCount) || 0;
  const productCount = Number(product.reviewCount) || 0;
  const eligibleOrders = details.eligibleOrders;
  const reviewAccess = !state.customer
    ? `<div class="review-access"><span class="review-access-icon" aria-hidden="true">🔒</span>
       <div><b>¿Ya compraste este producto?</b><p>Inicia sesión para valorar tu compra cuando haya sido entregada.</p></div>
       <button type="button" class="btn" id="reviewLogin">Iniciar sesión</button>
       <button type="button" class="text-action" id="reviewRegister">Crear cuenta</button>
      </div>`
    : eligibleOrders?.length
      ? `<form class="review-form" id="reviewForm">
           <h3>Cuéntanos cómo te fue</h3>
           <p class="form-intro">Solo puedes opinar sobre productos de pedidos entregados.</p>
           <label>Elige tu pedido entregado
             <select name="orderId" id="reviewOrder" required>
               ${eligibleOrders.map((order) => `
                 <option value="${escapeHtml(order.id)}" data-delivery-reviewed="${String(order.deliveryReviewed)}">
                   Pedido #${escapeHtml(order.id)} · ${escapeHtml(formattedReviewDate(order.createdAt))}
                 </option>
               `).join("")}
             </select>
           </label>
           ${ratingPickerMarkup("productRating", "Tu calificación del producto")}
           <label>Comentario del producto <span class="optional-label">(opcional)</span>
             <textarea name="productComment" rows="3" maxlength="2000" placeholder="¿Qué te pareció?"></textarea>
           </label>
           <div id="deliveryRatingArea">
             ${ratingPickerMarkup("deliveryRating", "Tu calificación de la entrega")}
             <label>Comentario de la entrega <span class="optional-label">(opcional)</span>
               <textarea name="deliveryComment" rows="3" maxlength="2000" placeholder="¿Cómo llegó tu pedido?"></textarea>
             </label>
           </div>
           <p class="delivery-already" id="deliveryAlready" hidden>Ya valoraste la entrega de este pedido; aquí solo guardaremos tu opinión del producto.</p>
           <p class="review-form-error" id="reviewFormError" role="alert" hidden></p>
           <button class="btn" type="submit">Publicar mi opinión</button>
         </form>`
      : `<p class="review-access-note">${state.customer
        ? "Las opiniones se habilitan cuando tu pedido aparece como entregado. Si ya publicaste tu opinión de cada compra, ¡gracias por compartirla!"
        : "Inicia sesión para valorar un producto comprado y entregado."}</p>`;
  return `
    <div class="detail-layout">
      <div class="detail-gallery">
        <div class="detail-image">${image}<span class="emoji" ${source ? "hidden" : ""} aria-hidden="true">🐾</span></div>
        <span class="detail-category">${escapeHtml(product.category || "PetNica")}</span>
      </div>
      <div class="detail-copy">
        <span class="eyebrow">HECHO PARA SUS PATITAS</span>
        <h2 id="productDialogTitle">${escapeHtml(product.name)}</h2>
        <div class="detail-rating">${ratingSummaryMarkup(product.rating, product.reviewCount)}</div>
        <p class="detail-description">${escapeHtml(product.description || "Un favorito seleccionado con cariño para tu mascota.")}</p>
        <label class="detail-variant-label" for="detailVariant">Presentación</label>
        <div class="detail-buy-row">
          <select id="detailVariant" ${variants.length <= 1 ? "hidden" : ""}>${options}</select>
          <span class="detail-price" id="detailPrice">${firstVariant ? money(firstVariant.price) : "No disponible"}</span>
          <button class="btn" type="button" id="detailAdd" ${!firstVariant || Number(firstVariant.stock) < 1 ? "disabled" : ""}>
            ${!firstVariant || Number(firstVariant.stock) < 1 ? "Agotado" : "Agregar"}
          </button>
        </div>
        <small class="stock" id="detailStock">${firstVariant && Number(firstVariant.stock) > 0
          ? `Disponible · ${Number(firstVariant.stock)} en stock`
          : "Sin existencias por el momento"}</small>
      </div>
    </div>
    <div class="detail-reviews">
      <section class="review-section">
        <div class="review-section-title"><div><span class="eyebrow">DE QUIENES YA LO PROBARON</span><h3>Opiniones del producto</h3></div>
          <strong>${productCount ? `${Number(product.rating).toFixed(1)} / 5` : "Nuevo"}</strong></div>
        ${productCount ? `<div class="review-aggregate">${starsMarkup(product.rating)}<span>${productCount} ${productCount === 1 ? "opinión" : "opiniones"}</span></div>` : ""}
        <div class="review-list">${reviewCardsMarkup(details.reviews || [], "Aún no hay opiniones. ¡Sé la primera persona en compartir la tuya!")}</div>
      </section>
      <section class="review-section delivery-reviews">
        <div class="review-section-title"><div><span class="eyebrow">HASTA TU PUERTA</span><h3>Experiencia de entrega</h3></div>
          <strong>${deliveryCount ? `${Number(details.deliveryRating).toFixed(1)} / 5` : "—"}</strong></div>
        ${deliveryCount ? `<div class="review-aggregate">${starsMarkup(details.deliveryRating)}<span>${deliveryCount} ${deliveryCount === 1 ? "opinión" : "opiniones"}</span></div>` : ""}
        <div class="review-list">${reviewCardsMarkup(details.deliveryReviews || [], "Aún no hay opiniones sobre las entregas.")}</div>
      </section>
    </div>
    <section class="review-write">${reviewAccess}</section>
  `;
}

function updateDeliveryReviewForm() {
  const orderSelect = $("#reviewOrder");
  if (!orderSelect) return;
  const deliveryReviewed = orderSelect.selectedOptions[0]?.dataset.deliveryReviewed === "true";
  $("#deliveryRatingArea").hidden = deliveryReviewed;
  $("#deliveryAlready").hidden = !deliveryReviewed;
  const rating = $("#deliveryRatingArea [name=deliveryRating]");
  rating.required = !deliveryReviewed;
}

async function loadProductDetails(productId) {
  state.activeProductId = String(productId);
  const dialog = $("#productDialog");
  $("#productDetailContent").innerHTML = '<p class="empty">Cargando el detalle del producto…</p>';
  if (!dialog.open) dialog.showModal();
  try {
    const response = await fetch(`/api/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
    const details = await response.json();
    if (!response.ok) throw new Error(details.error || "No se pudo cargar el producto.");
    if (state.activeProductId !== String(productId)) return;
    const catalogProduct = state.products.find((item) => String(item.id) === String(productId));
    if (catalogProduct) {
      catalogProduct.rating = details.product.rating;
      catalogProduct.reviewCount = details.product.reviewCount;
    }
    $("#productDetailContent").innerHTML = productDetailMarkup(details);
    const selector = $("#detailVariant");
    const updateVariant = () => {
      const variant = selectedVariant(details.product, selector);
      $("#detailPrice").textContent = variant ? money(variant.price) : "No disponible";
      $("#detailStock").textContent = variant && Number(variant.stock) > 0
        ? `Disponible · ${Number(variant.stock)} en stock`
        : "Sin existencias por el momento";
      $("#detailAdd").disabled = !variant || Number(variant.stock) < 1;
      $("#detailAdd").textContent = $("#detailAdd").disabled ? "Agotado" : "Agregar";
    };
    selector?.addEventListener("change", updateVariant);
    $("#detailAdd").addEventListener("click", () => {
      const variant = selectedVariant(details.product, selector);
      if (!variant) return;
      $("#productDialog").close();
      addProduct(details.product, variant);
    });
    const reviewForm = $("#reviewForm");
    if (reviewForm) {
      addRatingPickerBehavior(reviewForm);
      $("#reviewOrder").addEventListener("change", updateDeliveryReviewForm);
      updateDeliveryReviewForm();
      reviewForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const errorBox = $("#reviewFormError");
        errorBox.hidden = true;
        const data = new FormData(reviewForm);
        const payload = {
          productId: details.product.id,
          orderId: data.get("orderId"),
          productRating: data.get("productRating"),
          productComment: data.get("productComment"),
          deliveryRating: $("#deliveryRatingArea").hidden ? null : data.get("deliveryRating"),
          deliveryComment: $("#deliveryRatingArea").hidden ? null : data.get("deliveryComment"),
        };
        if (!payload.productRating) {
          errorBox.textContent = "Elige una calificación para el producto.";
          errorBox.hidden = false;
          return;
        }
        const submitButton = reviewForm.querySelector('[type="submit"]');
        submitButton.disabled = true;
        try {
          await accountRequest("/api/account/reviews", { method: "POST", body: payload });
          await loadProductDetails(details.product.id);
          renderProducts();
        } catch (error) {
          errorBox.textContent = error.message;
          errorBox.hidden = false;
          submitButton.disabled = false;
        }
      });
    }
    $("#reviewLogin")?.addEventListener("click", () => {
      setAccountMode("login");
      $("#accountDialog").showModal();
    });
    $("#reviewRegister")?.addEventListener("click", () => {
      setAccountMode("register");
      $("#accountDialog").showModal();
    });
  } catch (error) {
    $("#productDetailContent").innerHTML = `<p class="account-error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

function renderPlans() {
  const plans = matchingPlans();
  if (!plans.some((plan) => String(plan.id) === String(state.selectedPlan?.id))) {
    state.selectedPlan = plans[0] || null;
  }
  $("#sizes").innerHTML = plans.map((plan) => `
    <button type="button" aria-pressed="${String(plan.id) === String(state.selectedPlan?.id)}"
      data-plan-id="${escapeHtml(plan.id)}">${escapeHtml(plan.size || "Plan gato")}</button>
  `).join("");
  $("#sizes").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPlan = plans.find((plan) => String(plan.id) === button.dataset.planId) || null;
      renderPlans();
    });
  });
  $("#boxPrice").textContent = state.selectedPlan
    ? `${money(state.selectedPlan.price)} al mes`
    : "Planes no disponibles";
  $("#addBox").disabled = !state.selectedPlan;
}

function addProduct(product, variant) {
  const cartLine = state.cart.find((line) => line.variantId === String(variant.id));
  const quantity = (cartLine?.quantity || 0) + 1;
  if (quantity > Number(variant.stock)) return;
  state.orderCreated = false;
  $("#orderSuccess").hidden = true;
  if (cartLine) {
    cartLine.quantity = quantity;
  } else {
    state.cart.push({
      id: String(variant.id),
      variantId: String(variant.id),
      name: product.name,
      presentation: variant.presentation,
      price: Number(variant.price),
      stock: Number(variant.stock),
      quantity: 1,
    });
  }
  renderCart(true);
  openCart();
}

function addPetbox() {
  if (!state.selectedPlan) return;
  state.orderCreated = false;
  $("#orderSuccess").hidden = true;
  const existing = state.cart.find((line) => line.isPetbox);
  const line = {
    id: "petbox",
    isPetbox: true,
    planId: String(state.selectedPlan.id),
    species: state.selectedPlan.species,
    size: state.selectedPlan.size,
    name: state.selectedPlan.name,
    price: Number(state.selectedPlan.price),
    quantity: 1,
    petName: existing?.petName || null,
  };
  if (existing) Object.assign(existing, line);
  else state.cart.push(line);
  renderCart(true);
  openCart();
}

function changeQuantity(id, direction) {
  const line = state.cart.find((item) => item.id === id);
  if (!line) return;
  if (line.isPetbox) {
    if (direction < 0) state.cart = state.cart.filter((item) => item.id !== id);
  } else {
    const nextQuantity = line.quantity + direction;
    if (nextQuantity < 1) state.cart = state.cart.filter((item) => item.id !== id);
    else if (nextQuantity <= line.stock) line.quantity = nextQuantity;
  }
  renderCart(true);
}

function renderCart(cartChanged = false) {
  const count = state.cart.reduce((total, line) => total + line.quantity, 0);
  $("#count").textContent = count;
  $("#cartCountLabel").textContent = count ? `(${count})` : "";
  $("#items").innerHTML = state.cart.length ? state.cart.map((line) => `
    <div class="line">
      <div>
        <b>${escapeHtml(line.name)}</b>
        <small>${escapeHtml(line.presentation || (line.isPetbox ? "Suscripción mensual" : ""))}</small>
        <div class="qty">
          <button type="button" aria-label="Quitar uno de ${escapeHtml(line.name)}" data-change="-1" data-line="${escapeHtml(line.id)}">−</button>
          ${line.quantity}
          ${line.isPetbox ? "" : `<button type="button" aria-label="Agregar uno de ${escapeHtml(line.name)}" data-change="1" data-line="${escapeHtml(line.id)}">+</button>`}
        </div>
      </div>
      <b>${money(line.price * line.quantity)}</b>
    </div>
  `).join("") : '<p class="sub">Tu carrito está vacío. Agrega algo rico para tu mascota. 🐾</p>';

  $("#items").querySelectorAll("[data-line]").forEach((button) => {
    button.addEventListener("click", () => changeQuantity(button.dataset.line, Number(button.dataset.change)));
  });
  $("#petFields").hidden = !state.cart.some((line) => line.isPetbox);
  $("#petFields").querySelector('[name="petName"]').required = !$("#petFields").hidden;
  $("#petFields").querySelector('[name="petSize"]').required = !$("#petFields").hidden
    && state.cart.some((line) => line.isPetbox && line.species === "perro");
  $("#sizeField").hidden = !state.cart.some((line) => line.isPetbox && line.species === "perro");
  const petboxLine = state.cart.find((line) => line.isPetbox);
  if (petboxLine?.petName) $("#petFields").querySelector('[name="petName"]').value = petboxLine.petName;
  if (petboxLine?.size) $("#petFields").querySelector('[name="petSize"]').value = petboxLine.size;

  const subtotal = state.cart.reduce((total, line) => total + line.price * line.quantity, 0);
  const zone = state.zones.find((item) => String(item.id) === $("#zone").value);
  const estimatedShipping = zone ? Number(zone.fee) : null;
  const discount = state.promo ? Math.round(subtotal * 10) / 100 : 0;
  const total = subtotal - discount + (estimatedShipping || 0);
  $("#sum").innerHTML = `
    <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
    ${state.promo ? `<div><span>PETNICA10 · estimado</span><span>− ${money(discount)}</span></div>` : ""}
    <div><span>Envío ${estimatedShipping === null ? "(por confirmar)" : ""}</span><span>${estimatedShipping === null ? "—" : money(estimatedShipping)}</span></div>
    <div><b>Total ${estimatedShipping === null ? "estimado" : ""}</b><b>${money(total)}</b></div>
  `;
  updateCheckoutAccountRequirement();
  if (state.cartHydrated) {
    persistLocalCart(cartChanged);
    scheduleAccountCartSave();
  }
}

function openCart() {
  $("#cart").inert = false;
  $("#cart").classList.add("on");
  $("#veil").classList.add("on");
  $("#cart").setAttribute("aria-hidden", "false");
  $("#closeCart").focus();
}

function closeCart() {
  $("#cart").classList.remove("on");
  $("#veil").classList.remove("on");
  $("#cart").setAttribute("aria-hidden", "true");
  $("#cart").inert = true;
  $("#openCart").focus();
}

function renderZones() {
  $("#zone").innerHTML = '<option value="">Selecciona tu distrito</option>' + state.zones.map((zone) => `
    <option value="${escapeHtml(zone.id)}">${escapeHtml(zone.district)} · ${money(zone.fee)} · ${escapeHtml(zone.days)} día(s)</option>
  `).join("");
}

function setAccountMode(mode) {
  const registering = mode === "register";
  $$("[data-auth-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.authMode === mode));
  });
  $("#loginSection").hidden = registering;
  $("#registerSection").hidden = !registering;
  $("#accountError").hidden = true;
}

function customerOrderMarkup(order) {
  const status = {
    pendiente: "Pendiente",
    confirmado: "Confirmado",
    preparando: "Preparando",
    en_camino: "En camino",
    entregado: "Entregado",
    cancelado: "Cancelado",
  }[order.status] || order.status;
  const lines = order.items.map((item) =>
    `<li>${escapeHtml(item.quantity)} × ${escapeHtml(item.name)} · ${money(Number(item.unitPrice) * Number(item.quantity))}</li>`,
  );
  if (order.petboxName) lines.push(`<li>1 × ${escapeHtml(order.petboxName)}</li>`);
  return `
    <article class="customer-order">
      <div class="customer-order-top"><b>Pedido #${escapeHtml(order.id)} · ${money(order.total)}</b>
        <time datetime="${escapeHtml(order.createdAt)}">${escapeHtml(new Intl.DateTimeFormat("es-NI", { dateStyle: "medium" }).format(new Date(order.createdAt)))}</time>
      </div>
      <ul>${lines.join("") || "<li>Pedido guardado</li>"}</ul>
      <small>${escapeHtml(order.shippingAddress)}</small>
      <div class="customer-order-bottom"><span class="status-label">${escapeHtml(status)}</span>
        <button class="invoice-button" type="button" data-invoice-id="${escapeHtml(order.id)}">Ver comprobante / Imprimir</button>
      </div>
    </article>
  `;
}

function printInvoice(orderId) {
  const order = state.orders.find((item) => String(item.id) === String(orderId));
  if (!order) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showAccountError("Permite las ventanas emergentes para imprimir el comprobante.");
    return;
  }
  printWindow.opener = null;
  const items = order.items.map((item) => `
    <tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.quantity)}</td>
      <td>${money(item.unitPrice)}</td><td>${money(Number(item.unitPrice) * Number(item.quantity))}</td></tr>
  `).join("") + (order.petboxName ? `
    <tr><td>${escapeHtml(order.petboxName)} (suscripción)</td><td>1</td>
      <td>${money(Number(order.subtotal) - order.items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0))}</td>
      <td>${money(Number(order.subtotal) - order.items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0))}</td></tr>
  ` : "");
  const documentHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Comprobante PetNica #${escapeHtml(order.id)}</title><style>
      body{font:15px/1.5 Arial,sans-serif;color:#173d3b;max-width:760px;margin:36px auto;padding:0 22px}
      h1{color:#148d80;margin-bottom:3px}h2{margin-top:30px;font-size:18px}
      .muted{color:#597572}.head{display:flex;justify-content:space-between;gap:15px;border-bottom:2px solid #d9e8e5;padding-bottom:18px}
      table{width:100%;border-collapse:collapse;margin-top:15px}th,td{text-align:left;padding:10px 7px;border-bottom:1px solid #d9e8e5}
      th{background:#edf6f3}.number{text-align:right}.totals{width:min(330px,100%);margin:20px 0 0 auto}
      .total{font-weight:bold;font-size:18px}.note{margin-top:35px;padding-top:12px;border-top:1px solid #d9e8e5;font-size:12px;color:#597572}
      @media print{body{margin:0 auto;padding:0 8mm}.no-print{display:none}}
    </style></head><body><div class="head"><div><h1>PetNica</h1><span class="muted">Comprobante de pedido</span></div>
    <div><b>Pedido #${escapeHtml(order.id)}</b><br>${escapeHtml(new Intl.DateTimeFormat("es-NI", { dateStyle: "long", timeStyle: "short" }).format(new Date(order.createdAt)))}</div></div>
    <h2>Cliente</h2><div>${escapeHtml(order.firstName)} ${escapeHtml(order.lastName)}<br>${escapeHtml(order.email)}<br>${escapeHtml(order.phone || "")}</div>
    <h2>Entrega</h2><div>${escapeHtml(order.shippingAddress)}</div>
    <h2>Detalle</h2><table><thead><tr><th>Artículo</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>${items}</tbody></table>
    <div class="totals"><div>Subtotal: ${money(order.subtotal)}</div><div>Descuento: − ${money(order.discount)}</div><div>Envío: ${money(order.shipping)}</div><p class="total">Total: ${money(order.total)}</p></div>
    <p class="note">Comprobante informativo de pedido PetNica; no sustituye una factura fiscal. Gracias por tu compra. 🐾</p>
    <button class="no-print" onclick="window.print()">Imprimir / Guardar como PDF</button></body></html>`;
  printWindow.document.open();
  printWindow.document.write(documentHtml);
  printWindow.document.close();
  printWindow.focus();
}

async function loadCustomerOrders() {
  const result = await accountRequest("/api/account/orders");
  state.orders = result.orders;
  $("#customerOrders").innerHTML = state.orders.length
    ? state.orders.map(customerOrderMarkup).join("")
    : '<p class="empty">Aún no tienes pedidos. Tu historial aparecerá aquí cuando compres.</p>';
  $$("#customerOrders [data-invoice-id]").forEach((button) => {
    button.addEventListener("click", () => printInvoice(button.dataset.invoiceId));
  });
}

function showCustomer(customer) {
  state.customer = customer;
  $("#authView").hidden = true;
  $("#customerView").hidden = false;
  $("#customerName").textContent = `${customer.firstName} ${customer.lastName}`;
  $("#customerEmail").textContent = customer.email;
  $("#openAccount").textContent = `Hola, ${customer.firstName}`;
  fillCheckoutProfile(customer);
  updateCheckoutAccountRequirement();
  showAccountError("");
}

function showAccountLogin() {
  state.customer = null;
  $("#authView").hidden = false;
  $("#customerView").hidden = true;
  $("#openAccount").textContent = "Mi cuenta";
  fillCheckoutProfile(null);
  updateCheckoutAccountRequirement();
  setAccountMode("login");
}

async function openAccount() {
  showAccountError("");
  if (!$("#accountDialog").open) $("#accountDialog").showModal();
  if (!state.customer) {
    showAccountLogin();
    return;
  }
  showCustomer(state.customer);
  $("#customerOrders").innerHTML = '<p class="empty">Cargando tus pedidos…</p>';
  try {
    await loadCustomerOrders();
  } catch (error) {
    $("#customerOrders").innerHTML = `<p class="account-error">${escapeHtml(error.message)}</p>`;
  }
}

async function finishCustomerAuth(result) {
  state.csrfToken = result.csrfToken;
  showCustomer(result.customer);
  try {
    const savedCart = await accountRequest("/api/account/cart");
    mergeSavedCart(savedCart);
  } catch (error) {
    showAccountError(`Iniciaste sesión, pero no se pudo recuperar el carrito: ${error.message}`);
    state.cartHydrated = true;
    renderCart();
  }
  $("#customerOrders").innerHTML = '<p class="empty">Cargando tus pedidos…</p>';
  try {
    await loadCustomerOrders();
  } catch (error) {
    $("#customerOrders").innerHTML = `<p class="account-error">${escapeHtml(error.message)}</p>`;
  }
  if (state.activeProductId) await loadProductDetails(state.activeProductId);
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/catalog");
    const catalog = await response.json();
    if (!response.ok) throw new Error(catalog.error || "No se pudo cargar la tienda.");
    state.categories = catalog.categories;
    state.products = catalog.products;
    state.plans = catalog.plans;
    state.zones = catalog.zones;
    state.whatsapp = catalog.whatsapp || "";
    renderZones();
    setSpecies(state.species);
    renderCart();
  } catch (error) {
    $("#lead").textContent = "No pudimos conectar con la tienda. Intenta recargar la página en un momento.";
    $("#grid").innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    $("#sizes").innerHTML = "";
    $("#boxPrice").textContent = "No disponible";
  }
}

function whatsappLink(order) {
  if (!order.whatsapp) return "";
  const message = [
    `Hola PetNica 🐾, acabo de registrar el pedido #${order.orderId}.`,
    ...order.items.map((item) => `- ${item.quantity} x ${item.name} (${money(item.price)})`),
    `Subtotal: ${money(order.subtotal)}`,
    `Descuento: ${money(order.discount)}`,
    `Envío: ${money(order.shipping)}`,
    `Total: ${money(order.total)}`,
    `Entrega: ${order.shippingAddress}`,
    "¿Me ayudan a confirmar los detalles? ¡Gracias!",
  ].join("\n");
  return `https://wa.me/${encodeURIComponent(order.whatsapp)}?text=${encodeURIComponent(message)}`;
}

async function submitOrder(event) {
  event.preventDefault();
  if (!state.customer) {
    openAccount();
    return;
  }
  if (!state.cart.length || state.orderCreated) return;
  $("#checkoutError").hidden = true;
  $("#orderSuccess").hidden = true;
  $("#submitOrder").disabled = true;
  $("#submitOrder").textContent = "Registrando tu pedido…";

  const form = new FormData($("#checkout"));
  const petboxLine = state.cart.find((line) => line.isPetbox);
  const payload = {
    firstName: form.get("firstName"),
    lastName: form.get("lastName"),
    email: form.get("email"),
    phone: form.get("phone"),
    zoneId: form.get("zoneId"),
    neighborhood: form.get("neighborhood"),
    reference: form.get("reference"),
    paymentMethod: form.get("paymentMethod"),
    promoCode: state.promo ? "PETNICA10" : null,
    items: state.cart.filter((line) => !line.isPetbox)
      .map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
    petbox: petboxLine ? {
      planId: petboxLine.planId,
      petName: form.get("petName"),
      size: petboxLine.species === "perro" ? form.get("petSize") : null,
    } : null,
  };

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo registrar el pedido.");
    state.orderCreated = true;
    const link = whatsappLink(result);
    $("#orderSuccess").innerHTML = `
      <b>¡Pedido #${escapeHtml(result.orderId)} registrado!</b>
      <span>Total con envío: ${money(result.total)}. ${link ? "Confirma los detalles por WhatsApp:" : "Pronto nos pondremos en contacto contigo."}</span>
      ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Continuar por WhatsApp ↗</a>` : ""}
    `;
    $("#orderSuccess").hidden = false;
    $("#submitOrder").textContent = "Pedido registrado";
    state.cart = [];
    state.promo = false;
    $("#promo").checked = false;
    renderCart(true);
    if (state.customer && $("#accountDialog").open) {
      loadCustomerOrders().catch((error) => showAccountError(`El pedido se guardó, pero no se pudo actualizar el historial: ${error.message}`));
    }
    $("#orderSuccess").scrollIntoView({ block: "nearest" });
  } catch (error) {
    $("#checkoutError").textContent = error.message;
    $("#checkoutError").hidden = false;
    $("#submitOrder").disabled = false;
    $("#submitOrder").textContent = "Confirmar pedido";
  }
}

async function submitAccountForm(event, endpoint) {
  event.preventDefault();
  showAccountError("");
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const payload = Object.fromEntries(form.entries());
  try {
    const result = await accountRequest(endpoint, { method: "POST", body: payload });
    formElement.reset();
    await finishCustomerAuth(result);
  } catch (error) {
    showAccountError(error.message);
  }
}

$$(".pick button").forEach((button) => {
  button.addEventListener("click", () => setSpecies(button.dataset.species));
});
$("#addBox").addEventListener("click", addPetbox);
$("#openCart").addEventListener("click", openCart);
$("#closeCart").addEventListener("click", closeCart);
$("#veil").addEventListener("click", closeCart);
$("#checkout").addEventListener("submit", submitOrder);
$("#promo").addEventListener("change", (event) => {
  state.promo = event.target.checked;
  renderCart();
});
$("#zone").addEventListener("change", renderCart);
$("#openAccount").addEventListener("click", openAccount);
$("#checkoutAccount").addEventListener("click", openAccount);
$("#closeAccount").addEventListener("click", () => $("#accountDialog").close());
$("#closeProductDialog").addEventListener("click", () => $("#productDialog").close());
$("#productDialog").addEventListener("close", () => {
  state.activeProductId = null;
});
$("#productDialog").addEventListener("click", (event) => {
  if (event.target === $("#productDialog")) $("#productDialog").close();
});
$("#accountDialog").addEventListener("click", (event) => {
  if (event.target === $("#accountDialog")) $("#accountDialog").close();
});
$$("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => setAccountMode(button.dataset.authMode));
});
$("#loginForm").addEventListener("submit", (event) => submitAccountForm(event, "/api/account/login"));
$("#registerForm").addEventListener("submit", (event) => submitAccountForm(event, "/api/account/register"));
$("#googleLogin").addEventListener("click", (event) => {
  if (!state.googleConfigured) {
    event.preventDefault();
    showAccountError("El acceso con Google aún no está configurado.");
  }
});
$("#accountLogout").addEventListener("click", async () => {
  const logoutButton = $("#accountLogout");
  let cartSaveWarning = "";
  logoutButton.disabled = true;
  try {
    window.clearTimeout(state.cartSyncTimer);
    if (state.customer && state.cartHydrated) {
      try {
        await accountRequest("/api/account/cart", { method: "PUT", body: cartPayload() });
        cartSyncPending = false;
        persistLocalCart(false, state.customer.id);
      } catch (error) {
        console.error("No se pudo guardar el último cambio del carrito al cerrar sesión:", error);
        cartSaveWarning = "Tu sesión se cerró, pero no se pudo sincronizar el último cambio del carrito. El carrito de este navegador se conserva.";
      }
    }
    await accountRequest("/api/account/logout", { method: "POST" });
    state.customer = null;
    state.cartHydrated = true;
    showAccountLogin();
    renderCart();
    if (state.activeProductId) await loadProductDetails(state.activeProductId);
    if (cartSaveWarning) showAccountError(cartSaveWarning);
  } catch (error) {
    if (error.message === "Inicia sesión para continuar.") {
      state.customer = null;
      state.cartHydrated = true;
      showAccountLogin();
      renderCart();
      if (state.activeProductId) await loadProductDetails(state.activeProductId);
    }
    showAccountError(error.message);
  } finally {
    logoutButton.disabled = false;
  }
});
$("#petFields").querySelector('[name="petName"]').addEventListener("input", (event) => {
  const petboxLine = state.cart.find((line) => line.isPetbox);
  if (!petboxLine) return;
  petboxLine.petName = event.target.value.trim() || null;
  persistLocalCart(true);
  scheduleAccountCartSave();
});
$("#petFields").querySelector('[name="petSize"]').addEventListener("change", (event) => {
  const petboxLine = state.cart.find((line) => line.isPetbox);
  if (!petboxLine) return;
  const plan = state.plans.find((item) => String(item.id) === petboxLine.planId);
  if (plan?.species === "perro" && event.target.value !== plan.size) {
    event.target.value = plan.size;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#cart").classList.contains("on")) closeCart();
});
window.addEventListener("pagehide", () => {
  if (!state.customer || !state.cartHydrated) return;
  window.clearTimeout(state.cartSyncTimer);
  fetch("/api/account/cart", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": state.csrfToken,
    },
    body: JSON.stringify(cartPayload()),
    keepalive: true,
  }).catch((error) => console.error("No se pudo enviar el último guardado del carrito:", error));
});
$("#year").textContent = new Date().getFullYear();
$("#stage img").onerror = () => {
  $("#stage img").hidden = true;
  $("#stageEm").hidden = false;
};
$("#cart").inert = true;

async function initialize() {
  try {
    const session = await accountRequest("/api/account/session");
    state.csrfToken = session.csrfToken || "";
    state.googleConfigured = Boolean(session.googleConfigured);
    $("#googleLogin").hidden = !state.googleConfigured;
    $("#authDivider").hidden = !state.googleConfigured;
    if (session.authenticated) {
      state.customer = session.customer;
      fillCheckoutProfile(state.customer);
      $("#openAccount").textContent = `Hola, ${state.customer.firstName}`;
    }
  } catch (error) {
    console.error("No se pudo comprobar la sesión de cliente:", error);
  }

  await loadCatalog();
  if (state.customer) {
    try {
      mergeSavedCart(await accountRequest("/api/account/cart"));
    } catch (error) {
      console.error("No se pudo recuperar el carrito de la cuenta:", error);
      mergeSavedCart({ items: [], petbox: null });
      showAccountError(`No se pudo recuperar el carrito guardado: ${error.message}`);
    }
  } else {
    mergeSavedCart({ items: [], petbox: null });
  }

  const accountResult = new URLSearchParams(window.location.search).get("cuenta");
  if (accountResult) {
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
    await openAccount();
    if (accountResult === "google-success") {
      showAccountError("");
      $("#accountError").hidden = true;
      $("#accountError").textContent = "";
      $("#customerOrders").insertAdjacentHTML("afterbegin", '<p class="account-welcome">¡Tu cuenta de Google quedó conectada!</p>');
    } else {
      showAccountLogin();
      showAccountError("No se pudo completar el acceso con Google. Intenta de nuevo.");
    }
  }
}

initialize();
