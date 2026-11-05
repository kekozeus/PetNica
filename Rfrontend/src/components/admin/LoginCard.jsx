import { motion } from 'framer-motion'

import Field from './Field.jsx'

export default function LoginCard({ t, loginError, busy, onSubmit }) {
  return (
    <motion.section className="login-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <span className="eyebrow">{t.login.eyebrow}</span>
      <h1>{t.login.title}</h1>
      <p>{t.login.description}</p>

      <form onSubmit={onSubmit}>
        <Field label={t.login.email}>
          <input name="email" type="email" autoComplete="username" maxLength="150" required />
        </Field>

        <Field label={t.login.password}>
          <input name="password" type="password" autoComplete="current-password" required />
        </Field>

        {loginError && <p className="message error" role="alert">{loginError}</p>}

        <button className="button primary" type="submit" disabled={busy}>
          {busy ? t.login.loading : t.login.submit}
        </button>
      </form>

      <small>{t.login.initialAccount}</small>
    </motion.section>
  )
}
