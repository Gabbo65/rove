// Appearance: turns the look settings (color theme, accent, corners, density, font) into CSS for Rove's own
// UI and built-in pages. Served as pb://shared/look.css after theme.css; open pages swap it live on change.
// It always writes every value (also the defaults), so a newer sheet fully replaces an older one.
const os = require('os');
const { nativeTheme } = require('electron');
const settings = require('./settings');

// Each theme: a light and a dark palette. "default" = the colors in src/ui/shared/theme.css.
const P = (strip, chrome, page, card, border, line, field, fg, muted, accent) => ({ strip, chrome, page, card, border, line, field, fg, muted, accent });
const THEMES = {
  default: {
    name: 'Default',
    light: P('#e9e9ec', '#f7f7f8', '#f7f7f8', '#ffffff', '#d6d6da', '#e3e3e6', '#ffffff', '#1b1b1f', '#6e6e76', '#0f6cbd'),
    dark: P('#1f1f1f', '#2c2c2c', '#262626', '#2f2f2f', '#3d3d3d', '#3a3a3a', '#1d1d1d', '#f0f0f0', '#a3a3a8', '#4ca0f0'),
  },
  lavender: {
    name: 'Rove',
    light: P('#e6e3f5', '#f6f4fd', '#f6f4fd', '#ffffff', '#d3cdea', '#e4e0f3', '#ffffff', '#1d1a2e', '#6c6785', '#6b5ce7'),
    dark: P('#17142b', '#241f3f', '#1e1a35', '#2a2547', '#3d3663', '#352f58', '#151227', '#efedf9', '#a9a3c8', '#a99bff'),
  },
  midnight: {
    name: 'Midnight',
    light: P('#e3e8f0', '#f4f7fb', '#f4f7fb', '#ffffff', '#cfd8e6', '#e0e6ef', '#ffffff', '#141b26', '#5f6b7d', '#2563eb'),
    dark: P('#0b0f17', '#141a24', '#10151e', '#19202c', '#263041', '#212a39', '#0a0e15', '#e6edf6', '#8d99ab', '#5b9dff'),
  },
  forest: {
    name: 'Forest',
    light: P('#e2ebe3', '#f3f8f3', '#f3f8f3', '#ffffff', '#ccdccf', '#dfe9e0', '#ffffff', '#17241a', '#5e7062', '#2f8a4c'),
    dark: P('#121a14', '#1c271e', '#17201a', '#212d24', '#314235', '#2a382d', '#0f1611', '#e5f0e7', '#93a898', '#5cc77f'),
  },
  sunset: {
    name: 'Sunset',
    light: P('#f3e6df', '#fbf5f1', '#fbf5f1', '#ffffff', '#e6d3c8', '#f0e2da', '#ffffff', '#2a1c16', '#7d675c', '#d9592c'),
    dark: P('#1c1411', '#2a1f1a', '#231a16', '#31251f', '#47362d', '#3d2f28', '#16100d', '#f6ece6', '#b29c90', '#ff8a5c'),
  },
  mono: {
    name: 'Mono',
    light: P('#e8e8e8', '#f8f8f8', '#f8f8f8', '#ffffff', '#d0d0d0', '#e2e2e2', '#ffffff', '#111111', '#6a6a6a', '#111111'),
    dark: P('#0d0d0d', '#1a1a1a', '#141414', '#1f1f1f', '#333333', '#2a2a2a', '#0a0a0a', '#f2f2f2', '#9a9a9a', '#f2f2f2'),
  },
  contrast: {
    name: 'High contrast',
    light: P('#ffffff', '#ffffff', '#ffffff', '#ffffff', '#000000', '#000000', '#ffffff', '#000000', '#2b2b2b', '#0040c0'),
    dark: P('#000000', '#000000', '#000000', '#000000', '#ffffff', '#ffffff', '#000000', '#ffffff', '#d8d8d8', '#ffd400'),
  },
};

const ACCENTS = ['#0f6cbd', '#6b5ce7', '#c239b3', '#e0245e', '#d9592c', '#c69000', '#2f8a4c', '#0f8b8d', '#111111'];

const FONTS = {
  system: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif',
  serif: 'ui-serif, "New York", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

// Heights of the tab strip / tabs / toolbar / address bar / favorites bar.
const DENSITY = {
  compact: { strip: 34, tab: 29, toolbar: 36, url: 28, favbar: 28, button: 26 },
  normal: { strip: 40, tab: 34, toolbar: 42, url: 32, favbar: 32, button: 30 },
  roomy: { strip: 46, tab: 39, toolbar: 48, url: 36, favbar: 36, button: 34 },
};

const HEX = /^#[0-9a-f]{6}$/i;

// Text on an accent-colored background: black or white, whichever reads better.
function onColor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#111111' : '#ffffff';
}

// The colors one window uses (also for the native window background / Windows title bar).
function palette(dark, s = settings.all()) {
  const theme = THEMES[s.lookTheme] || THEMES.default;
  const p = { ...(dark ? theme.dark : theme.light) };
  if (HEX.test(s.accentColor || '')) p.accent = s.accentColor.toLowerCase();
  p.accentFg = onColor(p.accent);
  return p;
}

function vars(p, dark) {
  return [
    `--strip:${p.strip}`, `--chrome:${p.chrome}`, `--page:${p.page}`, `--card:${p.card}`, `--border:${p.border}`,
    `--line:${p.line}`, `--field:${p.field}`, `--fg:${p.fg}`, `--muted:${p.muted}`, `--accent:${p.accent}`,
    `--accent-fg:${p.accentFg}`,
    dark ? '--hover:rgba(255,255,255,.08);--press:rgba(255,255,255,.14);--tab-hover:rgba(255,255,255,.06)'
      : '--hover:rgba(0,0,0,.06);--press:rgba(0,0,0,.1);--tab-hover:rgba(255,255,255,.55)',
    // glass helpers: tint of the frosted toolbar, the tab strip's extra shade, the active tab, glass edges
    // (kept light: even a 25% layer over the system blur makes it look solid)
    dark ? '--glass:color-mix(in srgb,var(--accent) 6%,transparent);--glass-shade:rgba(0,0,0,.1);--glass-tab:rgba(255,255,255,.14);--glass-edge:rgba(255,255,255,.18);--glass-card:rgba(255,255,255,.07);--glass-field:rgba(0,0,0,.2)'
      : '--glass:color-mix(in srgb,var(--accent) 5%,transparent);--glass-shade:rgba(0,0,0,.04);--glass-tab:rgba(255,255,255,.5);--glass-edge:rgba(255,255,255,.6);--glass-card:rgba(255,255,255,.42);--glass-field:rgba(255,255,255,.45)',
  ].join(';');
}

// Docked Glass needs the system's blur behind the window: macOS, or Windows 11 (22H2+). Linux can't do it.
function glassSupported() {
  if (process.platform === 'darwin') return true;
  if (process.platform === 'win32') return Number(os.release().split('.')[2]) >= 22621;
  return false;
}
// What's really on, after the system's "Reduce transparency" (accessibility) setting and platform support.
function glass(s = settings.all()) {
  const reduced = !!nativeTheme.prefersReducedTransparency;
  const pages = s.pagesStyle === 'glass' && !reduced;
  // pagesNative: the window gets the system blur for Rove's pages too (also with a solid toolbar)
  // blur off (clear glass) needs a transparent window: macOS only (on Windows it breaks resizing)
  const blur = s.glassBlur !== false || process.platform !== 'darwin';
  return { toolbar: s.toolbarStyle === 'docked' && glassSupported() && !reduced, pages, pagesNative: pages && glassSupported(), blur, reduced };
}

const GLASS_TOOLBAR = [
  // one frosted layer (the window's own blur shows through), a slightly darker strip, tabs as glass
  ':root:not(.private) #top,:root:not(.private) body.vtabs #side{background:color-mix(in srgb,color-mix(in srgb,var(--accent) 6%,var(--chrome)) var(--glass-o),transparent);border-color:var(--glass-edge)}',
  ':root:not(.private) #tabstrip{background:var(--glass-shade)}',
  ':root:not(.private) body.vtabs #tabstrip{background:transparent}',
  ':root:not(.private) #toolbar,:root:not(.private) #favbar{background:transparent}',
  ':root:not(.private) .tab.active{background:var(--glass-tab);box-shadow:inset 0 1px 0 var(--glass-edge)}',
  ':root:not(.private) .tab.active::before,:root:not(.private) .tab.active::after{display:none}',
  ':root:not(.private) #urlform{background:color-mix(in srgb,var(--field) var(--glass-o),transparent)}',
];
// Pages Glass with the system blur: Rove's own pages are see-through, so the window is glass on them.
const GLASS_WINDOW_PAGES = [
  'html:has(>body.pg),html:has(>body.pg-newtab:not(.has-bg)){background:transparent!important}',
  'body.pg,body.pg-newtab:not(.has-bg){background:color-mix(in srgb,var(--page) var(--glass-o),transparent)!important}',
  // the system already blurs behind the window: no CSS blur here (inside see-through views it smears and leaves ghosts)
  '.pg .card,.pg-history section,.pg-history .search,.pg-newtab:not(.has-bg) #f,.pg-newtab:not(.has-bg) #tiles .icon,.pg-newtab:not(.has-bg) #customize,.pg-newtab:not(.has-bg) #clock'
    + '{background:color-mix(in srgb,var(--card) var(--glass-o),transparent);-webkit-backdrop-filter:none;backdrop-filter:none}',
  '.pg aside{background:var(--glass-shade)}',
  // every box that showed the solid theme color turns to glass too (theme preview cards keep their colors)
  '.pg .tb-list,.pg .btn,.pg .acc.auto,.pg-history .bulk{background:color-mix(in srgb,var(--card) var(--glass-o),transparent)}',
  '.pg .tb-row{background:transparent}',
  '.pg .seg{background:var(--glass-shade)}.pg .seg button.on{background:var(--glass-tab)}',
  '.pg .field,.pg select{background:color-mix(in srgb,var(--field) var(--glass-o),transparent)}',
  '.pg .thumb,.pg .grads button{box-shadow:inset 0 0 0 1px var(--glass-edge)}',
];
const GLASS_SURFACE = 'background:color-mix(in srgb,var(--card) 38%,transparent);-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%);'
  + 'box-shadow:inset 0 1px 1px var(--glass-edge),inset 0 0 0 1px color-mix(in srgb,var(--glass-edge) 45%,transparent),0 8px 30px rgba(0,0,0,.16)';
const GLASS_PAGES = [
  // New Tab page: clock in a glass pill, glass search box, tiles and Customize button
  `.pg-newtab #f,.pg-newtab #tiles .icon,.pg-newtab #customize{${GLASS_SURFACE}}`,
  `.pg-newtab.has-bg #f,.pg-newtab.has-bg #tiles .icon,.pg-newtab.has-bg #customize,.pg-newtab.has-bg #clock{background:rgba(255,255,255,.13)}`,
  `.pg-newtab #clock{display:inline-block;padding:14px 34px;border-radius:28px;${GLASS_SURFACE}}`,
  '.pg-newtab.has-bg #f input,.pg-newtab.has-bg #customize{color:#fff}.pg-newtab.has-bg #f input::placeholder{color:rgba(255,255,255,.8)}',
  // Settings + History: soft accent light behind glass cards
  '.pg{background:radial-gradient(circle at 12% 8%,color-mix(in srgb,var(--accent) 20%,transparent),transparent 42%),'
    + 'radial-gradient(circle at 88% 70%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 48%),var(--page) fixed}',
  `.pg .card,.pg-history section,.pg-history .search{${GLASS_SURFACE}}`,
  '.pg aside{background:color-mix(in srgb,var(--page) 40%,transparent)}',
];

function css(s = settings.all(), { custom = true } = {}) {
  const g = glass(s);
  const d = DENSITY[s.uiDensity] || DENSITY.normal;
  const square = s.uiCorners === 'square';
  const out = [
    '/* Generated from Settings → Appearance */',
    // InPrivate windows keep their own purple look (theme.css .private).
    `:root:not(.private){${vars(palette(false, s), false)};--font:${FONTS[s.uiFont] || FONTS.system}}`,
    `@media (prefers-color-scheme: dark){:root:not(.private){${vars(palette(true, s), true)}}}`,
    `.private{--font:${FONTS[s.uiFont] || FONTS.system}}`,
    // density (only the browser UI has these elements)
    `#tabstrip{height:${d.strip}px}`,
    `.tab{height:${d.tab}px}`,
    `#tabstrip #newtab{height:${d.tab - 6}px}`, // the toolbar's + button only (pages have their own #newtab)
    `#toolbar{height:${d.toolbar}px}`,
    `#urlform{height:${d.url}px;border-radius:${square ? 4 : d.url / 2}px}`,
    `#toolbar button.icon{height:${d.button}px}`,
    `#favbar{height:${d.favbar}px}`,
  ];
  if (square) {
    out.push(
      '.tab{border-radius:0}',
      '.tab.active::before,.tab.active::after{display:none}',
      'button.icon,.btn,#remote-btn,#update-btn,#star,.tab .close,.seg,.seg button,.field{border-radius:3px}',
      '.popup,#fav-pop,#save-pop,.card,#suggest,.sheet,form{border-radius:4px}',
      '.tab .fav img,.letter{border-radius:2px}',
    );
  }
  // Transparency slider, straight line: 0 = fully solid theme colors, 100 = no tint at all (only the system blur)
  out.push(`:root{--glass-o:${100 - (Number.isFinite(s.glassLevel) ? s.glassLevel : 85)}%}`);
  if (g.toolbar) out.push(...GLASS_TOOLBAR);
  if (g.pages) out.push(...GLASS_PAGES);              // glass cards (CSS blur) — the fallback without system blur
  if (g.pagesNative) out.push(...GLASS_WINDOW_PAGES); // see-through pages over the system blur (overrides the above)
  // Your own CSS goes last, so it wins. It only reaches Rove's UI and pages (look.css), never web pages.
  if (custom && s.customCss) out.push('/* Your CSS (Settings → Appearance → Custom CSS) */', s.customCss);
  return out.join('\n');
}

// Mac traffic lights stay centered in the tab strip; Windows / Linux title bar buttons match its height.
function stripHeight(s = settings.all()) {
  const d = DENSITY[s.uiDensity] || DENSITY.normal;
  return s.tabsPosition === 'left' ? d.toolbar : d.strip; // vertical tabs: the toolbar is the top row
}

module.exports = { THEMES, ACCENTS, FONTS, DENSITY, css, palette, stripHeight, glass, glassSupported };
