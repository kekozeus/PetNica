import { Link } from 'react-router-dom'
import { ArrowUpRight, MessageCircle } from 'lucide-react'

import { infoRoutes } from '../../features/info/content.js'

export default function InfoAside({ t, language, pageId, contactHref }) {
  const helpIds = infoRoutes.filter((route) => route.group === 'help')
  const policyIds = infoRoutes.filter((route) => route.group === 'policies')

  return (
    <aside className="info-aside">
      <nav className="info-page-nav" aria-label={language === 'es' ? 'Información de PetNica' : 'PetNica information'}>
        <strong>{language === 'es' ? 'Ayuda' : 'Help'}</strong>
        {helpIds.map(({ id, path }) => (
          <Link key={id} to={path} aria-current={id === pageId ? 'page' : undefined}>
            {t.nav[id]}
          </Link>
        ))}

        <strong>{language === 'es' ? 'Políticas' : 'Policies'}</strong>
        {policyIds.map(({ id, path }) => (
          <Link key={id} to={path} aria-current={id === pageId ? 'page' : undefined}>
            {t.nav[id]}
          </Link>
        ))}
      </nav>

      {(pageId === 'privacy' || pageId === 'returns' || pageId === 'terms') && (
        contactHref ? (
          <a className="info-aside-contact" href={contactHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={16} aria-hidden="true" />{t.whatsapp}<ArrowUpRight size={14} aria-hidden="true" />
          </a>
        ) : (
          <Link className="info-aside-contact" to="/contacto">
            {t.nav.contact}<ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        )
      )}
    </aside>
  )
}
