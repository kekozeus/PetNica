import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ScrollText, X } from 'lucide-react'

import { useLanguage } from '../../lib/useLanguage.js'
import { infoTranslations } from '../../features/info/content.js'

const PAGES = ['terms', 'privacy', 'shipping', 'returns']

export default function TermsGate({ open, onCancel, onAccept, t, prefersReducedMotion }) {
  const { t: info } = useLanguage(infoTranslations)
  const [tab, setTab] = useState('terms')
  const [remember, setRemember] = useState(false)

  const page = info.pages[tab]

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="veil on terms-gate-veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="terms-gate"
            role="dialog"
            aria-modal="true"
            aria-label={t.terms.title}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            <div className="terms-gate-head">
              <div>
                <span className="eyebrow">{t.terms.eyebrow}</span>
                <h2><ScrollText size={20} strokeWidth={1.9} aria-hidden="true" /> {t.terms.title}</h2>
                <p className="terms-intro">{t.terms.intro}</p>
              </div>
              <button className="close-btn" type="button" aria-label={t.cart.close} onClick={onCancel}>
                <X size={20} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>

            <div className="terms-gate-tabs" role="tablist" aria-label={t.terms.title}>
              {PAGES.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? 'active' : ''}
                  onClick={() => setTab(id)}
                >
                  {info.nav[id]}
                </button>
              ))}
            </div>

            <div className="terms-gate-body" role="tabpanel">
              <h3 className="terms-page-title">{page.title}</h3>
              <p className="terms-page-summary">{page.summary}</p>
              {page.sections.map((section) => (
                <section className="terms-section" key={section.title}>
                  <h4>{section.title}</h4>
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  {section.items?.length > 0 && (
                    <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
                  )}
                </section>
              ))}
            </div>

            <div className="terms-gate-foot">
              <label className="terms-remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>{t.terms.dontShow}</span>
              </label>
              <div className="terms-actions">
                <button className="terms-cancel" type="button" onClick={onCancel}>{t.terms.cancel}</button>
                <button className="btn" type="button" onClick={() => onAccept(remember)}>{t.terms.accept}</button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
