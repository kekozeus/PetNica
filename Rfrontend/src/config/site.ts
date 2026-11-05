const env = import.meta.env

export const siteConfig = {
  brandName: 'PetNica',
  legalBusinessName: '',
  contact: {
    // Fill public contact details here. Keep WHATSAPP_NUMBER in the backend in sync.
    whatsappNumber: '+50582279429',
    phone: '82279429',
    email: 'petnica@gmail.com',
    address: '',
  },
  // Use full public profile URLs, for example https://www.instagram.com/your-profile/.
  social: {
    instagram: '',
    facebook: '',
    tiktok: '',
  },
  seo: {
    // Prefer VITE_SITE_URL or VERCEL_PROJECT_PRODUCTION_URL for a custom production domain.
    siteUrl: env.VITE_SITE_URL || 'https://petnica-frontend.vercel.app',
    themeColor: '#f4f9f8',
    defaultTitle: 'PetNica | Todo para ellos, fácil para ti',
    defaultDescription: 'Alimentos, accesorios y PetBox para perros y gatos, con entrega en Managua y alrededores.',
    adminTitle: 'Administración | PetNica',
    adminDescription: 'Acceso privado para administrar la tienda PetNica.',
    locale: 'es_NI',
    socialImage: '/petnica-og.png',
    pages: [
      { path: '/', title: 'PetNica | Tienda para perros y gatos en Managua', description: 'Alimentos, accesorios y PetBox para perros y gatos, con entrega en Managua y alrededores.', priority: 1 },
      { path: '/proceso-de-compra', title: 'Cómo comprar | PetNica', description: 'Conoce los pasos para elegir productos, confirmar tu pedido y coordinar la entrega con PetNica.', priority: 0.6 },
      { path: '/contacto', title: 'Contacto | PetNica', description: 'Comunícate con PetNica para consultar productos, pedidos, pagos y entregas.', priority: 0.5 },
      { path: '/acerca-de-nosotros', title: 'Acerca de PetNica', description: 'Conoce PetNica, tienda en línea para perros y gatos con entrega en Managua y alrededores.', priority: 0.5 },
      { path: '/preguntas-frecuentes', title: 'Preguntas frecuentes | PetNica', description: 'Resuelve dudas sobre pedidos, entregas, pagos, cambios y devoluciones en PetNica.', priority: 0.6 },
      { path: '/politica-de-privacidad', title: 'Política de privacidad | PetNica', description: 'Conoce qué datos utiliza PetNica para administrar cuentas, pedidos y entregas.', priority: 0.3 },
      { path: '/politica-de-devoluciones', title: 'Cambios y devoluciones | PetNica', description: 'Consulta cómo reportar un producto dañado y el plazo para contactar a PetNica.', priority: 0.3 },
      { path: '/politica-de-envios', title: 'Envíos y entregas | PetNica', description: 'Consulta cobertura, costos y tiempos de entrega de PetNica en Managua y alrededores.', priority: 0.3 },
      { path: '/condiciones-de-compra', title: 'Condiciones de compra | PetNica', description: 'Revisa las condiciones para realizar pedidos, pagar y coordinar entregas con PetNica.', priority: 0.3 },
    ],
  },
}

export function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '')
}

export function getConfiguredSocialLinks() {
  return Object.entries(siteConfig.social)
    .filter(([, url]) => /^https:\/\/(www\.)?(instagram|facebook|tiktok)\.com\//i.test(url))
    .map(([network, url]) => ({ network, url }))
}
