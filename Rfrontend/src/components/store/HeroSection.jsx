import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Heart, PawPrint, Sparkles } from 'lucide-react'

import snoopyDog from '../../assets/SittingSnoppy.png'
import garfieldCat from '../../assets/Garfield.png'
import { storeTranslations } from '../../features/store/store.js'

const speciesImages = { perro: snoopyDog, gato: garfieldCat }
const MotionSparkles = motion.create(Sparkles)

const easeOut = [0.22, 1, 0.36, 1]

const copyList = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}

const copyItem = {
  hidden: { opacity: 0, y: 26, filter: 'blur(6px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.65, ease: easeOut },
  },
}

const dotPop = {
  hidden: { scale: 0 },
  show: { scale: 1, transition: { type: 'spring', stiffness: 500, damping: 15, delay: 0.15 } },
}

const titleAccent = {
  hidden: { opacity: 0, scale: 0.7, y: 10 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 380, damping: 17, delay: 0.55 },
  },
}

const pickWrap = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: easeOut, staggerChildren: 0.07, delayChildren: 0.12 },
  },
}

const pickItem = {
  hidden: { opacity: 0, y: 16, scale: 0.9, rotate: -4 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    rotate: 0,
    transition: { type: 'spring', stiffness: 400, damping: 22 },
  },
}

const ctaArrow = {
  show: { x: 0, transition: { type: 'spring', stiffness: 400, damping: 22 } },
  hover: { x: 4, transition: { type: 'spring', stiffness: 500, damping: 18 } },
}

const noteIcon = {
  hidden: { opacity: 0, scale: 0.3, rotate: -120 },
  show: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: { type: 'spring', stiffness: 320, damping: 15, delay: 0.15 },
  },
}

const orbit = (rotate, delay) => ({
  hidden: { opacity: 0, scale: 0.75, rotate: rotate - 30 },
  show: { opacity: 1, scale: 1, rotate, transition: { duration: 1, ease: easeOut, delay } },
})

const stageSwap = {
  hidden: (dir) => ({
    opacity: 0,
    scale: 0.82,
    x: dir * 46,
    y: 14,
    rotate: -4 - dir * 7,
  }),
  show: {
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    rotate: -4,
    transition: { type: 'spring', stiffness: 300, damping: 23, delay: 0.1 },
  },
  exit: {
    opacity: 0,
    scale: 0.85,
    y: -14,
    rotate: 3,
    transition: { duration: 0.25, ease: 'easeIn' },
  },
}

const floatTagMotion = (rotate, delay, bobDelay, reduced) => ({
  initial: reduced ? false : { opacity: 0, scale: 0.4, rotate },
  animate: reduced
    ? { opacity: 1, scale: 1, rotate }
    : { opacity: 1, scale: 1, rotate, y: [0, -5, 0] },
  transition: {
    opacity: { delay, duration: 0.3 },
    scale: { type: 'spring', stiffness: 280, damping: 16, delay },
    ...(reduced ? {} : { y: { delay: bobDelay, duration: 2.9, repeat: Infinity, ease: 'easeInOut' } }),
  },
})

const sparkMotion = (delay, reduced) => ({
  initial: reduced ? false : { opacity: 0, scale: 0, rotate: -30 },
  animate: { opacity: 1, scale: 1, rotate: 0 },
  transition: { type: 'spring', stiffness: 300, damping: 15, delay },
})

export default function HeroSection({ t, species, onSelectSpecies, catalogError, prefersReducedMotion }) {
  const initial = prefersReducedMotion ? false : 'hidden'
  const dir = species === 'gato' ? 1 : -1

  const stageContent = (
    <>
      <motion.img
        src={speciesImages[species]}
        alt=""
        initial={prefersReducedMotion ? false : { scale: 1.12 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.55, ease: easeOut }}
        onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextSibling.hidden = false }}
      />
      <span hidden>{t.species[species].emoji}</span>
    </>
  )

  return (
    <motion.section className="hero" initial={initial} animate="show">
      <motion.div className="hero-copy" variants={copyList}>
        <motion.span className="eyebrow" variants={copyItem}>
          <motion.span variants={dotPop}>
            <motion.span
              style={{ display: 'block' }}
              animate={prefersReducedMotion ? undefined : { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
              transition={prefersReducedMotion ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: 1.4 }}
            />
          </motion.span>
          {t.hero.eyebrow}
        </motion.span>
        <motion.h1 variants={copyItem}>
          {t.hero.titleStart}{' '}
          <motion.em variants={titleAccent} style={{ display: 'inline-block' }}>{t.hero.titleAccent}</motion.em>
          {' '}{t.hero.titleEnd}
        </motion.h1>
        <motion.p className="lead" variants={copyItem}>{catalogError ? t.hero.loadError : t.species[species].lead}</motion.p>

        <motion.div className="pick" role="group" aria-label={t.hero.speciesPicker} variants={pickWrap}>
          {['perro', 'gato'].map((kind) => (
            <motion.button
              key={kind}
              type="button"
              variants={pickItem}
              whileHover={prefersReducedMotion ? undefined : { y: -3 }}
              whileTap={prefersReducedMotion ? undefined : { scale: 0.94 }}
              aria-pressed={species === kind}
              onClick={() => onSelectSpecies(kind)}
            >
              <span className="em">{storeTranslations.es.species[kind].emoji}</span>
              {t.species[kind].button}
            </motion.button>
          ))}
        </motion.div>

        <motion.div
          variants={copyItem}
          style={{ display: 'inline-block' }}
          whileHover={prefersReducedMotion ? undefined : 'hover'}
          whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
        >
          <a className="btn" href="#tienda">
            {t.hero.discover}
            <motion.span variants={ctaArrow} style={{ display: 'inline-flex', verticalAlign: '-3px' }}>
              <ArrowRight size={17} strokeWidth={2} aria-hidden="true" />
            </motion.span>
          </a>
        </motion.div>

        <motion.div className="hero-note" variants={copyItem}>
          <MotionSparkles size={16} strokeWidth={1.8} aria-hidden="true" variants={noteIcon} />
          {t.hero.delivery}
        </motion.div>
      </motion.div>

      <div className="hero-art" aria-hidden="true">
        <motion.div className="art-orbit orbit-one" variants={orbit(-19, 0.15)} />
        <motion.div className="art-orbit orbit-two" variants={orbit(24, 0.28)} />
        {prefersReducedMotion ? (
          <motion.div
            className="stage"
            key={species}
            initial={{ opacity: 0, rotate: -4 }}
            animate={{ opacity: 1, rotate: -4 }}
            transition={{ duration: 0.15 }}
          >
            {stageContent}
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
            <motion.div className="stage" key={species} custom={dir} variants={stageSwap} exit="exit">
              {stageContent}
            </motion.div>
          </AnimatePresence>
        )}
        <motion.span className="float-tag tag-top" {...floatTagMotion(-4, 0.55, 1.6, prefersReducedMotion)}>
          {t.hero.loveTag} <Heart size={15} fill="currentColor" aria-hidden="true" />
        </motion.span>
        <motion.span className="float-tag tag-bottom" {...floatTagMotion(4, 0.7, 1.85, prefersReducedMotion)}>
          <PawPrint size={17} aria-hidden="true" /> {t.hero.happyTogether}
        </motion.span>
        <motion.span className="spark spark-one" {...sparkMotion(0.9, prefersReducedMotion)}>
          <MotionSparkles
            size={32}
            aria-hidden="true"
            animate={prefersReducedMotion ? undefined : { opacity: [1, 0.45, 1], scale: [1, 1.14, 1] }}
            transition={prefersReducedMotion ? undefined : { duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: 1.7 }}
          />
        </motion.span>
        <motion.span className="spark spark-two" {...sparkMotion(1.05, prefersReducedMotion)}>
          <MotionSparkles
            size={20}
            aria-hidden="true"
            animate={prefersReducedMotion ? undefined : { opacity: [1, 0.5, 1], scale: [1, 1.12, 1] }}
            transition={prefersReducedMotion ? undefined : { duration: 2.3, repeat: Infinity, ease: 'easeInOut', delay: 2.2 }}
          />
        </motion.span>
      </div>
    </motion.section>
  )
}
