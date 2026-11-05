import { Link } from 'react-router-dom'

import brandIcon from '../../assets/icon.png'

export default function AdminHeader({ t, language, setLanguage }) {
  return (
    <header className="admin-header">
      <Link className="logo brand-logo" to="/" aria-label={t.brand}>
        <span className="brand-logo-frame"><img src={brandIcon} alt="" width="1408" height="768" /></span>
      </Link>

      <label className="language-picker">
        <span className="visually-hidden">{t.language}</span>
        <select aria-label={t.language} value={language} onChange={(event) => setLanguage(event.target.value)}>
          <option value="es">{t.spanish}</option>
          <option value="en">{t.english}</option>
        </select>
      </label>

      <Link className="back-link" to="/">{t.back}</Link>
    </header>
  )
}
