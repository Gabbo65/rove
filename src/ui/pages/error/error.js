// Error page for failed loads and crashed pages. Text only (no HTML from the URL is ever inserted).
const p = new URLSearchParams(location.search);
const code = p.get('code') || '', desc = p.get('desc') || '', url = p.get('url') || '';
const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
const $ = (id) => document.getElementById(id);

const TIPS = {
  offline: ['Check your Wi-Fi or network cable', 'Try again in a moment'],
  dns: ['Check the address for typos', 'The site may no longer exist'],
  refused: ['The site may be down right now', 'Try again later'],
  cert: ['The site’s security certificate isn’t valid', 'Your connection to it may not be private'],
};
let kind = 'refused';
if (/INTERNET_DISCONNECTED|NETWORK_CHANGED/.test(desc)) kind = 'offline';
else if (/NAME_NOT_RESOLVED|NAME_RESOLUTION/.test(desc)) kind = 'dns';
else if (/CERT|SSL/.test(desc)) kind = 'cert';

if (code === 'crashed') {
  $('icon').textContent = '☹︎';
  $('title').textContent = 'This page crashed';
  $('msg').textContent = 'Something went wrong while showing this page.';
  $('tips').replaceChildren(...['Try reloading it', 'If it keeps happening, the page may be broken'].map((t) => Object.assign(document.createElement('li'), { textContent: t })));
} else {
  document.title = host ? `${host} — can’t reach this page` : document.title;
  $('msg').append('Couldn’t connect to ', Object.assign(document.createElement('code'), { textContent: host || url }), '.');
  $('tips').replaceChildren(...TIPS[kind].map((t) => Object.assign(document.createElement('li'), { textContent: t })));
}
$('code').textContent = [code !== 'crashed' && code, desc].filter(Boolean).join(' · ');
$('retry').onclick = () => window.pb.call('retry');
