// Apply the stored mode before React paints; works with the server's script-src 'self'.
try {
  var mode = localStorage.getItem('kitchen-theme') || 'system';
  document.documentElement.dataset.theme = mode === 'dark' || mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch (e) {}
