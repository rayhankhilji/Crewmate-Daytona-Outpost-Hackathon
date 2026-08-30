import type { Config } from 'tailwindcss'

/**
 * Every value here resolves to a custom property declared in
 * src/styles/tokens.css. Nothing in this file is a literal colour.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Restricted to the 4px scale in DESIGN.md — off-scale spacing is a defect.
    spacing: {
      '0': '0px',
      px: '1px',
      '1': 'var(--space-1)',
      '2': 'var(--space-2)',
      '3': 'var(--space-3)',
      '4': 'var(--space-4)',
      '6': 'var(--space-6)',
      '8': 'var(--space-8)',
      '12': 'var(--space-12)',
      '16': 'var(--space-16)',
    },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      bg: 'var(--bg)',
      surface: 'var(--surface)',
      'surface-raised': 'var(--surface-raised)',
      'surface-sunken': 'var(--surface-sunken)',
      border: 'var(--border)',
      'border-strong': 'var(--border-strong)',
      text: 'var(--text)',
      'text-muted': 'var(--text-muted)',
      'text-faint': 'var(--text-faint)',
      accent: 'var(--accent)',
      warning: 'var(--warning)',
      danger: 'var(--danger)',
      info: 'var(--info)',
      'accent-tint': 'var(--accent-tint)',
      'warning-tint': 'var(--warning-tint)',
      'danger-tint': 'var(--danger-tint)',
      'info-tint': 'var(--info-tint)',
      action: 'var(--action)',
      'action-text': 'var(--action-text)',
      screen: 'var(--screen)',
      'on-screen': 'var(--on-screen)',
      scrim: 'var(--scrim)',
      sand: 'var(--sand)',
      blush: 'var(--blush)',
      lavender: 'var(--lavender)',
      sky: 'var(--sky)',
      'status-complete': 'var(--status-complete)',
      'status-running': 'var(--status-running)',
      'status-skipped': 'var(--status-skipped)',
      'status-failed': 'var(--status-failed)',
      'status-pending': 'var(--status-pending)',
    },
    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
    fontSize: {
      xs: ['var(--text-xs)', 'var(--text-xs-lh)'],
      sm: ['var(--text-sm)', 'var(--text-sm-lh)'],
      base: ['var(--text-base)', 'var(--text-base-lh)'],
      lg: ['var(--text-lg)', 'var(--text-lg-lh)'],
      xl: ['var(--text-xl)', 'var(--text-xl-lh)'],
      '3xl': ['var(--text-3xl)', 'var(--text-3xl-lh)'],
    },
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
    },
    borderRadius: {
      none: '0px',
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      full: '9999px',
    },
    borderWidth: {
      DEFAULT: '1px',
      '0': '0px',
      '1': '1px',
      '2': '2px',
    },
    boxShadow: {
      card: 'var(--shadow-card)',
      raised: 'var(--shadow-raised)',
      modal: 'var(--shadow-modal)',
      none: 'none',
    },
    transitionTimingFunction: {
      DEFAULT: 'var(--ease)',
      owari: 'var(--ease)',
    },
    transitionDuration: {
      DEFAULT: 'var(--duration-base)',
      fast: 'var(--duration-fast)',
      base: 'var(--duration-base)',
      slow: 'var(--duration-slow)',
    },
    extend: {
      width: {
        rail: 'var(--rail-width)',
      },
      maxWidth: {
        content: 'var(--content-max)',
      },
      height: {
        control: '32px',
        'control-lg': '40px',
        full: '100%',
        screen: '100vh',
      },
      minHeight: {
        full: '100%',
        screen: '100vh',
      },
      aspectRatio: {
        tile: '16 / 10',
      },
    },
  },
  plugins: [],
}

export default config
