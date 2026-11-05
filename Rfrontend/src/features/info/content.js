import { infoContentEn } from './content.en.js'
import { infoContentEs } from './content.es.js'

export const infoRoutes = [
  { id: 'purchase', path: '/proceso-de-compra', group: 'help' },
  { id: 'contact', path: '/contacto', group: 'help' },
  { id: 'about', path: '/acerca-de-nosotros', group: 'help' },
  { id: 'faq', path: '/preguntas-frecuentes', group: 'help' },
  { id: 'privacy', path: '/politica-de-privacidad', group: 'policies' },
  { id: 'returns', path: '/politica-de-devoluciones', group: 'policies' },
  { id: 'shipping', path: '/politica-de-envios', group: 'policies' },
  { id: 'terms', path: '/condiciones-de-compra', group: 'policies' },
]

export const infoTranslations = {
  es: infoContentEs,
  en: infoContentEn,
}
