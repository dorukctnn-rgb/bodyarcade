// BodyArcade design tokens: the single source for tokens.css and tokens.json.
// Edit here, then run: node design/tools/build-tokens.mjs
// Contrast figures are WCAG 2.x ratios measured with design/tools/contrast.mjs.

export const palette = {
  // Hero. Used for "do this now": primary buttons, the in-game command plate, the target line.
  // Text on flush is always ink (5.5:1). White on flush fails AA, never use it.
  flush: { 100: '#FFE3E9', 200: '#FFC2CE', 500: '#FF4F6E', 600: '#F23A5C', 700: '#C8264A' },
  // Ink is aubergine, not black. Text on light surfaces, dark plates in the HUD.
  ink: { 900: '#1C1433', 800: '#2B2248', 700: '#3A3060', 500: '#5E5677', 300: '#A79FBE', 200: '#D9D4E5', 100: '#ECE9F3' },
  chalk: '#F4F2F8', // light background, a cool lilac white (not cream)
  paper: '#FFFFFF',
  night: { 950: '#140F27', 900: '#1A1430', 800: '#241C40', 700: '#31285A', 600: '#40366E' },
  sky: { 100: '#E0F2FF', 400: '#46B4FF', 700: '#1F6FB5' }, // right hand, information
  sun: { 100: '#FFF1CC', 400: '#FFC53A', 800: '#8A5A00' }, // left hand, stars and rewards
  go: { 100: '#D6F5E7', 400: '#22C383', 700: '#0E7A4E' }, // a hit, ready, done
};

// Semantic roles. Light is the default; dark applies with prefers-color-scheme or data-theme="dark".
export const themes = {
  light: {
    bg: palette.chalk,
    surface: palette.paper,
    'surface-sunken': palette.ink[100],
    'surface-inverse': palette.ink[900],
    text: palette.ink[900],
    'text-muted': palette.ink[500],
    'text-inverse': palette.chalk,
    border: palette.ink[200],
    'border-strong': palette.ink[900],
    accent: palette.flush[500],
    'accent-pressed': palette.flush[600],
    'accent-edge': palette.flush[700],
    'on-accent': palette.ink[900],
    'accent-text': palette.flush[700],
    'accent-tint': palette.flush[100],
    focus: palette.ink[900],
    'focus-halo': palette.flush[500],
    hit: palette.go[400],
    'hit-text': palette.go[700],
    left: palette.sun[400],
    right: palette.sky[400],
    info: palette.sky[700],
    reward: palette.sun[400],
    'reward-text': palette.sun[800],
    scrim: 'rgba(28, 20, 51, 0.56)',
  },
  dark: {
    bg: palette.night[900],
    surface: palette.night[800],
    'surface-sunken': palette.night[950],
    'surface-inverse': palette.chalk,
    text: palette.chalk,
    'text-muted': palette.ink[300],
    'text-inverse': palette.ink[900],
    border: palette.night[700],
    'border-strong': palette.chalk,
    accent: palette.flush[500],
    'accent-pressed': palette.flush[600],
    'accent-edge': palette.flush[700],
    'on-accent': palette.ink[900],
    'accent-text': '#FF8FA3',
    'accent-tint': '#3B1830',
    focus: palette.chalk,
    'focus-halo': palette.flush[500],
    hit: palette.go[400],
    'hit-text': '#5BE0A6',
    left: palette.sun[400],
    right: palette.sky[400],
    info: '#8CCFFF',
    reward: palette.sun[400],
    'reward-text': palette.sun[400],
    scrim: 'rgba(10, 6, 22, 0.66)',
  },
};

// HUD plates sit over a camera mirror or a game scene, so they never change with the theme.
export const hud = {
  'command-bg': palette.flush[500],
  'command-text': palette.ink[900],
  'plate-bg': 'rgba(28, 20, 51, 0.86)',
  'plate-text': palette.chalk,
  'plate-muted': palette.ink[300],
  line: palette.flush[500],
  'line-reached': palette.go[400],
  skeleton: palette.chalk,
  'skeleton-joint': palette.flush[500],
  ghost: palette.sky[400],
  'pip-frame': palette.chalk,
  'camera-on': palette.flush[500],
};

export const type = {
  // Font stacks. (Kept under `family`: a second `display` key below used to overwrite the
  // display stack, so --ba-font-display came out as "[object Object]" and Savate never loaded.)
  family: {
    display: '"Savate", "National Park", ui-sans-serif, system-ui, sans-serif',
    text: '"National Park", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  // Shell scale (read at arm's length). rem values; body is 1rem = 16px on phones, 17px from 768px.
  size: {
    xs: '0.8125rem', // 13
    sm: '0.9375rem', // 15
    md: '1rem', // 16 or 17
    lg: '1.1875rem', // 19
    xl: '1.4375rem', // 23
  },
  display: {
    sm: 'clamp(1.375rem, 1.15rem + 0.9vw, 1.75rem)',
    md: 'clamp(1.75rem, 1.35rem + 1.8vw, 2.75rem)',
    lg: 'clamp(2.25rem, 1.5rem + 3.4vw, 4.25rem)',
    xl: 'clamp(2.75rem, 1.6rem + 5.6vw, 6.25rem)',
  },
  weight: { text: 400, 'text-strong': 650, label: 600, display: 820, 'display-heavy': 900, numeric: 760 },
  leading: { tight: 0.98, display: 1.04, snug: 1.25, text: 1.5 },
  tracking: { display: '-0.018em', 'display-xl': '-0.026em', text: '0', caps: '0.02em' },
};

export const space = { 0: '0', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px', 16: '64px', 20: '80px', 24: '96px' };

// Radii follow hierarchy: small controls are tighter, big tiles and sheets rounder.
export const radius = { xs: '6px', sm: '10px', md: '14px', lg: '22px', xl: '32px', pill: '999px' };

export const motion = {
  'dur-press': '90ms',
  'dur-state': '160ms',
  'dur-enter': '240ms',
  'dur-celebrate': '420ms',
  'ease-out': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  'ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
  'ease-pop': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

export const elevation = {
  // Buttons press like an arcade button: a solid bottom edge, no blur.
  'button-edge': '0 4px 0 0',
  // Only floating layers (sheets, the PiP, toasts) get a soft shadow.
  float: '0 18px 40px -18px rgba(20, 12, 44, 0.45)',
};
