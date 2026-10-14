import { useEffect, useRef } from 'react';
import './App.css';

/**
 * Mount the legacy portal in the React document while its screens are migrated.
 * React owns lifecycle/loading; the original Firebase-backed controls remain
 * operational and no nested browsing context is created.
 */
export default function App() {
  const hostRef = useRef(null);
  const statusRef = useRef(null);

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
        if (!cancelled) statusRef.current?.remove();
      } catch (error) {
        console.error('Portal startup failed:', error);
        if (!cancelled && statusRef.current) {
          statusRef.current.textContent = 'The portal could not start. Check the connection and reload this page.';
        }
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
    <main className="portal-host" ref={hostRef} aria-label="Heaven and Hell Fitness Portal">
      <p className="portal-status" ref={statusRef} role="status">Loading fitness portal…</p>
    </main>
  );
}
