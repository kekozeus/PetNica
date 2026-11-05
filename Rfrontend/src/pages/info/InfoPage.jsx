import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { siteConfig, getConfiguredSocialLinks, normalizePhone } from '../../config/site.ts'
import { useLanguage } from '../../lib/useLanguage.js'
import { infoTranslations } from '../../features/info/content.js'
import './info.css'

import InfoAside from '../../components/info/InfoAside.jsx'
import InfoContactPanel from '../../components/info/InfoContactPanel.jsx'
import InfoFooter from '../../components/info/InfoFooter.jsx'
import InfoHeader from '../../components/info/InfoHeader.jsx'
import InfoHero from '../../components/info/InfoHero.jsx'
import InfoSections from '../../components/info/InfoSections.jsx'

export default function InfoPage({ pageId }) {
  const { language, setLanguage, t } = useLanguage(infoTranslations)
  const { pathname } = useLocation()
  const page = t.pages[pageId]
  const seoPage = siteConfig.seo.pages.find((item) => pathname.endsWith(item.path))

  const [apiWhatsapp, setApiWhatsapp] = useState('')
  const configuredWhatsapp = normalizePhone(siteConfig.contact.whatsappNumber || apiWhatsapp)
  const socials = getConfiguredSocialLinks()
  const contactHref = configuredWhatsapp ? `https://wa.me/${configuredWhatsapp}` : ''
  const phoneDigits = normalizePhone(siteConfig.contact.phone)
  const phoneHref = phoneDigits ? `tel:+${phoneDigits}` : ''
  const emailHref = siteConfig.contact.email ? `mailto:${siteConfig.contact.email}` : ''

  useEffect(() => {
    if (siteConfig.contact.whatsappNumber || pageId !== 'contact') return
    let active = true
    fetch('/api/catalog')
      .then((response) => response.ok ? response.json() : null)
      .then((catalog) => { if (active) setApiWhatsapp(catalog?.whatsapp || '') })
      .catch(() => {})
    return () => { active = false }
  }, [pageId])

  useEffect(() => {
    const previousTitle = document.title
    const description = document.querySelector('meta[name="description"]')
    const previousDescription = description?.content
    const previousLanguage = document.documentElement.lang
    let canonical = document.querySelector('link[rel="canonical"]')
    const createdCanonical = !canonical && Boolean(siteConfig.seo.siteUrl)
    if (createdCanonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.append(canonical)
    }
    document.title = `${page.title} | ${siteConfig.brandName}`
    if (description) description.content = page.summary
    document.documentElement.lang = language
    if (canonical && siteConfig.seo.siteUrl) canonical.href = `${siteConfig.seo.siteUrl.replace(/\/$/, '')}${seoPage?.path || pathname}`
    return () => {
      document.title = previousTitle
      if (description && previousDescription) description.content = previousDescription
      document.documentElement.lang = previousLanguage
      if (createdCanonical) canonical?.remove()
      else if (canonical && siteConfig.seo.siteUrl) canonical.href = `${siteConfig.seo.siteUrl.replace(/\/$/, '')}/`
    }
  }, [language, page.title, page.summary, pathname, seoPage?.path])

  return (
    <div className="info-page">
      <InfoHeader t={t} language={language} setLanguage={setLanguage} />

      <main className="info-main">
        <InfoHero t={t} page={page} pageId={pageId} language={language} />

        {pageId === 'contact' && (
          <InfoContactPanel
            t={t}
            contactHref={contactHref}
            phoneHref={phoneHref}
            emailHref={emailHref}
            phoneDigits={phoneDigits}
            socials={socials}
          />
        )}

        <div className="info-layout">
          <InfoAside t={t} language={language} pageId={pageId} contactHref={contactHref} />
          <InfoSections page={page} pageId={pageId} />
        </div>
      </main>

      <InfoFooter t={t} language={language} contactHref={contactHref} />
    </div>
  )
}
