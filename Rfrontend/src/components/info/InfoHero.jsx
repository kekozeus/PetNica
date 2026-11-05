import { Link } from 'react-router-dom'

import { siteConfig } from '../../config/site.ts'

export default function InfoHero({ t, page, pageId, language }) {
  return (
    <div className="info-hero">
      <nav className="info-breadcrumb" aria-label={language === 'es' ? 'Ruta de navegación' : 'Breadcrumb'}>
        <Link to="/">{siteConfig.brandName}</Link>
        <span aria-hidden="true">/</span>
        <span>{page.title}</span>
      </nav>

      <p className="info-eyebrow">{page.eyebrow}</p>
      <h1>{page.title}</h1>
      <p className="info-summary">{page.summary}</p>

      {['privacy', 'returns', 'shipping', 'terms'].includes(pageId) && (
        <p className="info-updated">{t.updated}</p>
      )}
    </div>
  )
}
