import { Link } from 'react-router-dom'
import { LockKeyhole, Truck } from 'lucide-react'

import brandIcon from '../../assets/icon.png'
import { siteConfig, getConfiguredSocialLinks, normalizePhone } from '../../config/site.ts'
import { infoRoutes, infoTranslations } from '../../features/info/content.js'

export default function StoreFooter({ t, language, year, whatsapp }) {
  const helpPages = infoRoutes.filter((route) => route.group === 'help')
  const policyPages = infoRoutes.filter((route) => route.group === 'policies')
  const footerWhatsapp = normalizePhone(siteConfig.contact.whatsappNumber || whatsapp)
  const footerSocials = getConfiguredSocialLinks()
  const infoText = infoTranslations[language]

  return (
    <footer>
      <div className="wrap footer-inner">
        <div>
          <a className="logo brand-logo" href="#top" aria-label={t.hero.homeAria}>
            <span className="brand-logo-frame"><img src={brandIcon} alt="" width="1408" height="768" /></span>
          </a>
          <p>{t.footer.motto}</p>
        </div>

        <div className="footer-right">
          <span>{t.footer.location}</span>
          {siteConfig.contact.phone && <a href={`tel:${normalizePhone(siteConfig.contact.phone)}`}>{siteConfig.contact.phone}</a>}
          {siteConfig.contact.email && <a href={`mailto:${siteConfig.contact.email}`}>{siteConfig.contact.email}</a>}
          {footerWhatsapp && <a href={`https://wa.me/${footerWhatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}

          <div className="footer-socials">
            {footerSocials.map(({ network, url }) => (
              <a key={network} href={url} target="_blank" rel="noopener noreferrer">{network}</a>
            ))}
          </div>

          <small>© {year} PetNica · {t.footer.copyright}</small>

          <Link className="footer-admin-access" to="/admin/login">
            <LockKeyhole size={12} strokeWidth={2} aria-hidden="true" />{t.footer.adminAccess}
          </Link>
          <Link className="footer-admin-access" to="/repartidor">
            <Truck size={12} strokeWidth={2} aria-hidden="true" />{t.footer.deliveryAccess}
          </Link>
        </div>

        <nav className="footer-resource-links" aria-label={language === 'es' ? 'Información y políticas' : 'Information and policies'}>
          <div>
            <b>{language === 'es' ? 'Ayuda' : 'Help'}</b>
            {helpPages.map(({ id, path }) => <Link key={id} to={path}>{infoText.nav[id]}</Link>)}
          </div>
          <div>
            <b>{language === 'es' ? 'Políticas' : 'Policies'}</b>
            {policyPages.map(({ id, path }) => <Link key={id} to={path}>{infoText.nav[id]}</Link>)}
          </div>
        </nav>
      </div>
    </footer>
  )
}
