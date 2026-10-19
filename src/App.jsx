import { useEffect, useRef } from 'react';
import './App.css';

/**
 * Mount the legacy portal in the React document while its screens are migrated.
 * React owns lifecycle/loading; the original Firebase-backed controls remain
 * operational and no nested browsing context is created.
 */
// The loading screen lives in index.html so it shows before any script has loaded.
async function hideSplash() {
  const splash = document.getElementById('hh-splash');
  if (!splash) return;
  // Let the web font arrive (briefly) so the home page doesn't reflow right after appearing.
  await Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, 1200))]);
  splash.classList.add('is-done');
  setTimeout(() => splash.remove(), 400);
}

function showSplashError() {
  const splash = document.getElementById('hh-splash');
  if (!splash) return;
  splash.classList.add('is-error');
  splash.querySelector('.hh-splash-msg').textContent = 'The portal could not load. Check your internet connection and try again.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => window.location.reload());
  splash.append(retry);
}

export default function App() {
  const hostRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    const addedStyles = [];
    const addedScripts = [];
    const addedNodes = [];

    async function mountPortal() {
      try {
        const response = await fetch('/heaven-hell.html');
        if (!response.ok) throw new Error(`Portal page returned ${response.status}`);
        const markup = await response.text();
        const parsed = new DOMParser().parseFromString(markup, 'text/html');
        document.title = parsed.title || 'HEAVEN & HELL Fitness Portal';

        // Linked stylesheets (fonts, theme) load before the markup appears to avoid a flash of unstyled content.
        await Promise.all([...parsed.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"]')].map((sourceLink) => {
          const link = document.createElement('link');
          for (const { name, value } of sourceLink.attributes) link.setAttribute(name, value);
          document.head.appendChild(link);
          addedStyles.push(link);
          if (link.rel !== 'stylesheet') return null;
          return new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; });
        }));

        parsed.querySelectorAll('style').forEach((sourceStyle) => {
          const style = document.createElement('style');
          style.textContent = sourceStyle.textContent;
          if (sourceStyle.id) style.id = sourceStyle.id;
          document.head.appendChild(style);
          addedStyles.push(style);
        });

        const sourceScripts = [...parsed.querySelectorAll('script')];
        sourceScripts.forEach((script) => script.remove());
        [...parsed.body.childNodes].forEach((node) => {
          const mountedNode = document.importNode(node, true);
          host.appendChild(mountedNode);
          addedNodes.push(mountedNode);
        });

        for (const sourceScript of sourceScripts) {
          if (cancelled) return;
          const script = document.createElement('script');
          for (const { name, value } of sourceScript.attributes) script.setAttribute(name, value);
          if (sourceScript.src) {
            await new Promise((resolve, reject) => {
              script.onload = resolve;
              script.onerror = () => reject(new Error(`Could not load ${sourceScript.src}`));
              document.body.appendChild(script);
            });
          } else {
            script.textContent = sourceScript.textContent;
            document.body.appendChild(script);
          }
          addedScripts.push(script);
        }
        if (!cancelled) await hideSplash();
      } catch (error) {
        console.error('Portal startup failed:', error);
        if (!cancelled) showSplashError();
      }
    }

    mountPortal();
    return () => {
      cancelled = true;
      addedScripts.forEach((script) => script.remove());
      addedNodes.forEach((node) => node.remove());
      addedStyles.forEach((style) => style.remove());
    };
  }, []);

  return (
    <main className="portal-host" ref={hostRef} aria-label="Heaven and Hell Fitness Portal" />
  );
}
