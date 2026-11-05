export default function HowSection({ t }) {
  return (
    <section id="como" className="how-section">
      <span className="eyebrow">{t.how.eyebrow}</span>
      <h2>{t.how.title}</h2>
      <p className="sub">{t.how.subtitle}</p>

      <ol className="steps">
        <li>
          <span>01</span>
          <b>{t.how.steps[0][0]}</b>
          <small>{t.how.steps[0][1]}</small>
        </li>
        <li>
          <span>02</span>
          <b>{t.how.steps[1][0]}</b>
          <small>{t.how.steps[1][1]}</small>
        </li>
        <li>
          <span>03</span>
          <b>{t.how.steps[2][0]}</b>
          <small>{t.how.steps[2][1]}</small>
        </li>
        <li>
          <span>04</span>
          <b>{t.how.steps[3][0]}</b>
          <small>{t.how.steps[3][1]}</small>
        </li>
      </ol>
    </section>
  )
}
