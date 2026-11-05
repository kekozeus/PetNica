import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import brandIcon from '../../assets/icon.png'
import { siteConfig } from '../../config/site.ts'

export default function InfoHeader({ t, language, setLanguage }) {
  return (
    <header className="info-header">
      <Link className="info-brand" to="/" aria-label={siteConfig.brandName}>
        <img src={brandIcon} alt="" />
        <span>{siteConfig.brandName}</span>
      </Link>

      <div className="info-header-actions">
        <label className="info-visually-hidden" htmlFor="info-language">{language === 'es' ? 'Idioma' : 'Language'}</label>
        <select id="info-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
        <Link className="info-back" to="/"><ArrowLeft size={16} aria-hidden="true" />{t.backToStore}</Link>
      </div>
    </header>
  )
}
