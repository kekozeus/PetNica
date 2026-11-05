import { Link } from 'react-router-dom'

export default function AdminFooter({ t }) {
  return (
    <footer>
      <span>{t.messages.secureFooter}</span>
      <Link to="/">{t.messages.goToStore}</Link>
    </footer>
  )
}
