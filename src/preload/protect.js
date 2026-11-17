// Hex Protection, in every frame of a web page (registered by src/main/hex/protection.js while Protection is on).
// An embedded frame from ANOTHER site (a video player, an ad box…) may not open popups or new tabs: real players
// never need to, ad players always do — and their ad addresses change too often for any list.
// The page itself (top frame) and same-site frames are untouched; links you really click still work everywhere.
const { webFrame, ipcRenderer } = require('electron');

// Your real clicks on links (in any frame) are reported, so "strict popups" sites still open the links YOU click.
// Ad scripts can't fake these: synthetic clicks have isTrusted = false.
for (const type of ['mousedown', 'click', 'auxclick']) { // mousedown: reported well before the page acts on the click
  window.addEventListener(type, (e) => {
    if (!e.isTrusted) return;
    const a = e.composedPath().find((n) => n && n.tagName === 'A' && n.href);
    if (a) ipcRenderer.send('protect:link', String(a.href));
  }, true);
}

let crossSite = false;
try {
  if (window.top !== window) {
    const top = window.top.location.href; // throws when the top page is another site
    crossSite = !top;
  }
} catch { crossSite = true; }

if (crossSite) {
  webFrame.executeJavaScript(`(() => {
    const blank = (a) => { const t = String(a && a.target || '').toLowerCase(); return !!t && !['_self', '_parent', '_top'].includes(t); };
    const no = () => null;
    try { Object.defineProperty(window, 'open', { value: no, writable: false, configurable: false }); } catch { window.open = no; }
    // ad scripts also make a hidden <a target=_blank> and "click" it themselves (not you): those don't open either
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (blank(this)) return; return click.call(this); };
    const dispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (e) {
      if (e && e.type === 'click' && this instanceof HTMLAnchorElement && blank(this)) return false;
      return dispatch.call(this, e);
    };
  })()`).catch(() => {});
}
