document.querySelectorAll('[data-store-link]').forEach((link) => {
  link.addEventListener('click', () => {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'chrome_web_store_click', {
        send_to: 'G-NG437YS67B',
        link_url: link.href
      });
    }
  });
});
