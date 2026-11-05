import { ArrowUpRight, Mail, MessageCircle } from 'lucide-react'

import { siteConfig } from '../../config/site.ts'

export default function InfoContactPanel({ t, contactHref, phoneHref, emailHref, phoneDigits, socials }) {
  return (
    <section className="info-contact-panel" aria-labelledby="info-contact-title">
      <div>
        <p className="info-eyebrow">{t.contactTitle}</p>
        <h2 id="info-contact-title">{t.contactIntro}</h2>
      </div>

      <div className="info-contact-actions">
        {contactHref && (
          <a className="info-contact-link info-whatsapp" href={contactHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={18} aria-hidden="true" />
            {t.whatsapp}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        )}
        {phoneHref && (
          <a className="info-contact-link" href={phoneHref}>
            {siteConfig.contact.phone || `+${phoneDigits}`}
          </a>
        )}
        {emailHref && (
          <a className="info-contact-link" href={emailHref}>
            <Mail size={18} aria-hidden="true" />
            {siteConfig.contact.email}
          </a>
        )}
        {!contactHref && !phoneHref && !emailHref && <p>{t.noContacts}</p>}
      </div>

      {siteConfig.contact.address && <p className="info-contact-address">{siteConfig.contact.address}</p>}

      {socials.length > 0 && (
        <div className="info-socials">
          {socials.map(({ network, url }) => (
            <a key={network} href={url} target="_blank" rel="noopener noreferrer">
              {network}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
