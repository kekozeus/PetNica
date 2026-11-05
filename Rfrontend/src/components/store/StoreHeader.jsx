import { useEffect, useState } from 'react'
import { Moon, PawPrint, Sun } from 'lucide-react'

import brandIcon from '../../assets/icon.png'

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('petnica-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* almacenamiento no disponible */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('petnica-theme', theme) } catch { /* almacenamiento no disponible */ }
  }, [theme])
  return [theme, setTheme]
}

export default function StoreHeader({ t, language, setLanguage, customer, showPromo = true, cartCount, onOpenAccount, onOpenCart }) {
  const [theme, setTheme] = useTheme()
  const nextThemeLabel = theme === 'dark' ? t.nav.themeLight : t.nav.themeDark

  return (
    <>
      {showPromo && <div className="promo"><PawPrint size={16} strokeWidth={2} aria-hidden="true" /> {t.promo} <b>PETNICA10</b></div>}

      <header className="top">
        <div className="wrap bar">
          <a className="logo brand-logo" href="#top" aria-label={t.hero.homeAria}>
            <span className="brand-logo-frame"><img src={brandIcon} alt="" width="1408" height="768" /></span>
          </a>

          <nav className="links" aria-label={t.nav.store}>
            <a href="#tienda">{t.nav.store}</a>
            <a href="#petbox">{t.nav.petbox}</a>
            <a href="#como">{t.nav.how}</a>
          </nav>

          <button className="accountbtn" type="button" onClick={onOpenAccount}>
            {customer ? `${t.account.hello}, ${customer.firstName}` : t.nav.account}
          </button>
          <button className="cartbtn" type="button" aria-label={t.nav.cart} onClick={onOpenCart}>
            {t.nav.cart} <b>{cartCount}</b>
          </button>
          <button
            className="theme-toggle"
            type="button"
            aria-label={nextThemeLabel}
            title={nextThemeLabel}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>

          <label className="language-picker">
            <span className="visually-hidden">{t.language}</span>
            <select aria-label={t.language} value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="es">{t.spanish}</option>
              <option value="en">{t.english}</option>
            </select>
          </label>
        </div>
      </header>
    </>
  )
}
