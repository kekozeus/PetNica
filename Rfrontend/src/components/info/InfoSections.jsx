function sectionId(title) {
  return title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function InfoSections({ page, pageId }) {
  return (
    <article className={`info-article${pageId === 'faq' ? ' is-faq' : ''}`}>
      {page.sections.map((section) => {
        const id = sectionId(section.title)

        if (pageId === 'faq') {
          return (
            <details className="info-faq-item" key={id}>
              <summary>{section.title}</summary>
              <div className="info-faq-answer">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </details>
          )
        }

        return (
          <section className="info-section" id={id} key={id}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items.length > 0 && (
              <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
          </section>
        )
      })}
    </article>
  )
}
