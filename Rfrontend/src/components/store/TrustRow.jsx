import { HeartHandshake, MessageCircle, Truck } from 'lucide-react'

export default function TrustRow({ t }) {
  return (
    <div className="trust-row" aria-label={t.hero.benefits}>
      <div>
        <span><Truck size={22} strokeWidth={1.9} aria-hidden="true" /></span>
        <b>{t.trust[0][0]}</b>
        <small>{t.trust[0][1]}</small>
      </div>
      <div>
        <span><HeartHandshake size={22} strokeWidth={1.9} aria-hidden="true" /></span>
        <b>{t.trust[1][0]}</b>
        <small>{t.trust[1][1]}</small>
      </div>
      <div>
        <span><MessageCircle size={22} strokeWidth={1.9} aria-hidden="true" /></span>
        <b>{t.trust[2][0]}</b>
        <small>{t.trust[2][1]}</small>
      </div>
    </div>
  )
}
