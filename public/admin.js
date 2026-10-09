const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const money = (value) => `C$ ${Number(value).toLocaleString("es-NI", { maximumFractionDigits: 2 })}`;
const dateTime = (value) => new Intl.DateTimeFormat("es-NI", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(value));
const orderStatuses = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  preparando: "Preparando",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};
const paymentStatuses = {
  pendiente: "Pendiente",
  verificado: "Verificado",
  rechazado: "Rechazado",
};
const state = { csrfToken: "", email: "", overview: null };

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = (options.method || "GET").toUpperCase();
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && state.csrfToken) {
    headers.set("X-CSRF-Token", state.csrfToken);
  }
  const response = await fetch(url, { ...options, method, headers });
  if (response.status === 204) return null;
  const result = await response.json();
  if (response.status === 401 && url !== "/api/admin/login") {
    state.csrfToken = "";
    showLogin();
  }
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
  return result;
}

function showLogin(message = "") {
  $("#loginView").hidden = false;
  $("#adminView").hidden = true;
  $("#loginError").textContent = message;
  $("#loginError").hidden = !message;
}

function showAdmin(session) {
  state.csrfToken = session.csrfToken;
  state.email = session.email;
  $("#loginView").hidden = true;
  $("#adminView").hidden = false;
  $("#adminEmail").textContent = `Sesión iniciada como ${state.email}`;
}

function showMessage(message, isError = false) {
  const element = $("#globalMessage");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.hidden = !message;
  if (message) window.setTimeout(() => { element.hidden = true; }, 5000);
}

async function refreshOverview() {
  state.overview = await request("/api/admin/overview");
  renderCategories();
  renderProducts();
  renderOrders();
}

function categoryOptions(selectedId) {
  return state.overview.categories.map((category) => `
    <option value="${escapeHtml(category.id)}" ${String(category.id) === String(selectedId) ? "selected" : ""}>
      ${escapeHtml(category.name)}
    </option>
  `).join("");
}

function renderCategories() {
  $("#createProductForm [name=categoryId]").innerHTML = `
    <option value="">Selecciona una categoría</option>
    ${categoryOptions("")}
  `;
}

function variantMarkup(variant) {
  return `
    <form class="variant-row" data-variant-id="${escapeHtml(variant.id)}">
      <label>SKU<input name="sku" maxlength="40" value="${escapeHtml(variant.sku)}" required></label>
      <label>Presentación<input name="presentation" maxlength="60" value="${escapeHtml(variant.presentation)}" required></label>
      <label>Precio<input name="price" type="number" min="0" step="0.01" value="${escapeHtml(variant.price)}" required></label>
      <label>Stock<input name="stock" type="number" min="0" step="1" value="${escapeHtml(variant.stock)}" required></label>
      <label class="active-check"><input name="active" type="checkbox" ${variant.active ? "checked" : ""}> Activa</label>
      <button class="button outline small" type="submit">Guardar</button>
    </form>
  `;
}

function productMarkup(product) {
  const image = typeof product.image === "string" && product.image
    ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.hidden=true;this.parentElement.textContent='Sin imagen'">`
    : "Sin imagen";
  return `
    <article class="product-card" data-product-id="${escapeHtml(product.id)}">
      <div class="product-heading">
        <div><h3>${escapeHtml(product.name)}</h3><small>${escapeHtml(product.category)} · ${product.variants.length} presentación(es)</small></div>
        <span class="count-pill">${product.active ? "Activo" : "Oculto"}</span>
      </div>
      <div class="product-grid">
        <div>
          <div class="product-image">${image}</div>
          <form class="product-image-form">
            <label>Reemplazar imagen<input name="image" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" required></label>
            <button class="button outline small" type="submit">Subir imagen</button>
            ${product.image && product.image.startsWith("/images/admin-") ? '<button class="button danger small remove-image" type="button">Quitar imagen</button>' : ""}
          </form>
        </div>
        <div>
          <form class="product-edit">
            <div class="product-fields">
              <label>Nombre<input name="name" maxlength="150" value="${escapeHtml(product.name)}" required></label>
              <label>Slug<input name="slug" maxlength="160" value="${escapeHtml(product.slug)}" required></label>
              <label>Categoría<select name="categoryId">${categoryOptions(product.categoryId)}</select></label>
              <label>Para<select name="species">
                <option value="perro" ${product.species === "perro" ? "selected" : ""}>Perro</option>
                <option value="gato" ${product.species === "gato" ? "selected" : ""}>Gato</option>
                <option value="ambos" ${product.species === "ambos" ? "selected" : ""}>Ambos</option>
              </select></label>
              <label class="active-check"><input name="active" type="checkbox" ${product.active ? "checked" : ""}> Visible en tienda</label>
            </div>
            <label>Descripción<textarea name="description" maxlength="5000" rows="2">${escapeHtml(product.description || "")}</textarea></label>
            <button class="button outline small" type="submit">Guardar producto</button>
          </form>
          <div class="variant-list">
            <b>Presentaciones e inventario</b>
            ${product.variants.length ? product.variants.map(variantMarkup).join("") : '<p class="help-text">Este producto no tiene presentaciones.</p>'}
            <details>
              <summary>＋ Agregar presentación</summary>
              <form class="variant-create">
                <div class="form-grid">
                  <label>SKU<input name="sku" maxlength="40" required></label>
                  <label>Presentación<input name="presentation" maxlength="60" required></label>
                  <label>Precio<input name="price" type="number" min="0" step="0.01" required></label>
                  <label>Existencias<input name="stock" type="number" min="0" step="1" required></label>
                </div>
                <button class="button outline small" type="submit">Agregar presentación</button>
              </form>
            </details>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const products = state.overview.products;
  $("#productCount").textContent = products.length;
  $("#productList").innerHTML = products.length
    ? products.map(productMarkup).join("")
    : '<p class="empty">Todavía no hay productos en tu catálogo.</p>';

  $$(".product-edit").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const productId = form.closest("[data-product-id]").dataset.productId;
      const data = new FormData(form);
      try {
        await request(`/api/admin/products/${productId}`, {
          method: "PUT",
          body: {
            name: data.get("name"),
            slug: data.get("slug"),
            description: data.get("description"),
            categoryId: data.get("categoryId"),
            species: data.get("species"),
            active: data.has("active"),
          },
        });
        await refreshOverview();
        showMessage("Producto actualizado.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });

  $$(".variant-row").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await request(`/api/admin/variants/${form.dataset.variantId}`, {
          method: "PUT",
          body: {
            sku: data.get("sku"),
            presentation: data.get("presentation"),
            price: data.get("price"),
            stock: data.get("stock"),
            active: data.has("active"),
          },
        });
        await refreshOverview();
        showMessage("Presentación e inventario actualizados.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });

  $$(".variant-create").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const productId = form.closest("[data-product-id]").dataset.productId;
      const data = new FormData(form);
      try {
        await request(`/api/admin/products/${productId}/variants`, {
          method: "POST",
          body: {
            sku: data.get("sku"),
            presentation: data.get("presentation"),
            price: data.get("price"),
            stock: data.get("stock"),
          },
        });
        await refreshOverview();
        showMessage("Presentación agregada.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });

  $$(".product-image-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const productId = form.closest("[data-product-id]").dataset.productId;
      const body = new FormData();
      const image = form.querySelector('[name="image"]').files[0];
      if (!image) return;
      body.append("image", image);
      try {
        await request(`/api/admin/products/${productId}/image`, { method: "POST", body });
        await refreshOverview();
        showMessage("Imagen actualizada.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });

  $$(".remove-image").forEach((button) => {
    button.addEventListener("click", async () => {
      const productId = button.closest("[data-product-id]").dataset.productId;
      try {
        await request(`/api/admin/products/${productId}/image`, { method: "DELETE" });
        await refreshOverview();
        showMessage("Imagen quitada.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });
}

function statusOptions(statuses, selected) {
  return Object.entries(statuses).map(([value, label]) => `
    <option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>
  `).join("");
}

function orderMarkup(order) {
  const items = order.items.map((item) => `
    <li>${escapeHtml(item.quantity)} × ${escapeHtml(item.name)} · ${money(item.unitPrice)}</li>
  `).join("") + (order.petboxName ? `<li>1 × ${escapeHtml(order.petboxName)}</li>` : "");
  const payment = order.paymentMethod === "transferencia"
    ? `<label>Estado de transferencia<select class="payment-status" data-order-id="${escapeHtml(order.id)}">
        ${statusOptions(paymentStatuses, order.paymentStatus)}
      </select></label>`
    : `<span class="order-meta">Pago: efectivo contra entrega</span>`;
  return `
    <article class="order-card">
      <div class="order-heading">
        <div><h3>Pedido #${escapeHtml(order.id)} · ${money(order.total)}</h3>
          <span class="order-meta">${escapeHtml(order.firstName)} ${escapeHtml(order.lastName)} · ${escapeHtml(order.email)}</span>
        </div>
        <time datetime="${escapeHtml(order.createdAt)}">${escapeHtml(dateTime(order.createdAt))}</time>
      </div>
      <div class="order-info">
        <div><span>WhatsApp</span> ${escapeHtml(order.phone)}</div>
        <div><span>Desglose</span> ${money(order.subtotal)} − ${money(order.discount)} + ${money(order.shipping)}</div>
        <div><span>Entrega</span> ${escapeHtml(order.shippingAddress)}</div>
        <div><span>Método de pago</span> ${order.paymentMethod === "transferencia" ? "Transferencia" : "Efectivo contra entrega"}</div>
      </div>
      <ul class="order-items">${items || "<li>Sin artículos en el pedido</li>"}</ul>
      <div class="order-actions">
        <label>Estado del pedido
          <select class="order-status" data-order-id="${escapeHtml(order.id)}">${statusOptions(orderStatuses, order.status)}</select>
        </label>
        ${payment}
        <a class="button outline small" href="https://wa.me/${escapeHtml(String(order.phone).replace(/\D/g, ""))}?text=${encodeURIComponent(`Hola ${order.firstName}, te escribimos de PetNica por tu pedido #${order.id}.`)}"
          target="_blank" rel="noopener noreferrer">Contactar</a>
      </div>
    </article>
  `;
}

function renderOrders() {
  const orders = state.overview.orders;
  $("#orderCount").textContent = orders.length;
  $("#orderList").innerHTML = orders.length
    ? orders.map(orderMarkup).join("")
    : '<p class="empty">Aún no hay pedidos registrados.</p>';

  $$(".order-status").forEach((select) => {
    select.addEventListener("change", async () => {
      const previous = select.dataset.previous || select.value;
      try {
        await request(`/api/admin/orders/${select.dataset.orderId}/status`, {
          method: "PUT",
          body: { status: select.value },
        });
        select.dataset.previous = select.value;
        await refreshOverview();
        showMessage("Estado del pedido actualizado.");
      } catch (error) {
        select.value = previous;
        showMessage(error.message, true);
      }
    });
  });

  $$(".payment-status").forEach((select) => {
    select.addEventListener("change", async () => {
      const previous = select.dataset.previous || select.value;
      try {
        await request(`/api/admin/orders/${select.dataset.orderId}/payment`, {
          method: "PUT",
          body: { status: select.value },
        });
        select.dataset.previous = select.value;
        await refreshOverview();
        showMessage("Estado del pago actualizado.");
      } catch (error) {
        select.value = previous;
        showMessage(error.message, true);
      }
    });
  });
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").hidden = true;
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    const session = await request("/api/admin/login", {
      method: "POST",
      body: { email: form.get("email"), password: form.get("password") },
    });
    formElement.reset();
    showAdmin(session);
    await refreshOverview();
  } catch (error) {
    $("#loginError").textContent = error.message;
    $("#loginError").hidden = false;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST" });
    state.csrfToken = "";
    showLogin();
  } catch (error) {
    showMessage(error.message, true);
  }
});

$("#createProductForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await request("/api/admin/products", {
      method: "POST",
      body: {
        name: form.get("name"),
        slug: form.get("slug"),
        description: form.get("description"),
        categoryId: form.get("categoryId"),
        species: form.get("species"),
        sku: form.get("sku"),
        presentation: form.get("presentation"),
        price: form.get("price"),
        stock: form.get("stock"),
      },
    });
    formElement.reset();
    await refreshOverview();
    showMessage("Producto creado.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

$$(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".tabs button").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
    $("#productsPanel").hidden = button.dataset.tab !== "products";
    $("#ordersPanel").hidden = button.dataset.tab !== "orders";
  });
});

async function initialize() {
  try {
    const session = await request("/api/admin/session");
    if (!session.authenticated) return showLogin();
    showAdmin(session);
    await refreshOverview();
  } catch (error) {
    showLogin(error.message);
  }
}

initialize();
