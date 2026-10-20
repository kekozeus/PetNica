import { useCallback, useState } from 'react'

const STORAGE_KEY = 'petnica.language'

function readLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'es'
  } catch {
    return 'es'
  }
}

export function useLanguage(translations) {
  const [language, setLanguageState] = useState(readLanguage)
  const setLanguage = useCallback((nextLanguage) => {
    const next = nextLanguage === 'en' ? 'en' : 'es'
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      setLanguageState(next)
      return
    }
    setLanguageState(next)
  }, [])

  return { language, setLanguage, t: translations[language], locale: language === 'en' ? 'en-US' : 'es-NI' }
}
