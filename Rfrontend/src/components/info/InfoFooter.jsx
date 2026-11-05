import { Link } from 'react-router-dom'

import { siteConfig } from '../../config/site.ts'

export default function InfoFooter({ t, language, contactHref }) {
  return (
    <footer className="info-footer">
      <Link to="/">{siteConfig.brandName}</Link>
      <Link to="/contacto">{t.nav.contact}</Link>
      <span>{language === 'es' ? 'Managua, Nicaragua' : 'Managua, Nicaragua'}</span>
      {contactHref && (
        <a href={contactHref} target="_blank" rel="noopener noreferrer">{t.whatsapp}</a>
      )}
    </footer>
  )
}
