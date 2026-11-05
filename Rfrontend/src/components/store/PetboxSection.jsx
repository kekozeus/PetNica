import { ArrowRight, Heart, PawPrint, Sparkles } from 'lucide-react'

export default function PetboxSection({ t, plans, selectedPlan, onSelectPlan, onAdd, formatMoney }) {
  return (
    <section id="petbox" className="petbox-section">
      <div className="box">
        <div className="box-copy">
          <span className="eyebrow">{t.petbox.eyebrow}</span>
          <h2>{t.petbox.title}<br />{t.petbox.titleSecond}</h2>
          <p className="sub">{t.petbox.description}</p>

          <div className="sizes" role="group" aria-label={t.petbox.planPicker}>
            {plans.map((plan) => (
              <button
                type="button"
                key={plan.id}
                aria-pressed={String(selectedPlan?.id) === String(plan.id)}
                onClick={() => onSelectPlan(String(plan.id))}
              >
                {plan.size || t.petbox.catPlan}
              </button>
            ))}
          </div>
        </div>

        <div className="box-visual">
          <Sparkles className="box-doodle doodle-one" size={32} aria-hidden="true" />
          <Heart className="box-doodle doodle-two" size={30} fill="currentColor" aria-hidden="true" />

          <div className="gift-box" aria-hidden="true">
            <PawPrint className="gift-paw" size={34} aria-hidden="true" /><b>PET<br />BOX</b>
          </div>

          <div className="box-price-wrap">
            <small>{t.petbox.from}</small>
            <div className="big">
              {selectedPlan ? `${formatMoney(selectedPlan.price)} ${t.petbox.priceSuffix}` : t.petbox.unavailable}
            </div>
            <small>{t.petbox.monthly}</small>
          </div>

          <button className="btn" id="addBox" type="button" disabled={!selectedPlan} onClick={onAdd}>
            {t.petbox.action} <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  )
}
