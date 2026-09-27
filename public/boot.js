/* Apply saved theme/language before first paint to avoid flashing */
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('mv:theme') || 'null');
    if (t !== 'light' && t !== 'dark') {
      t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = t;
    var l = JSON.parse(localStorage.getItem('mv:lang') || 'null');
    if (l !== 'fa' && l !== 'en') {
      l = (navigator.language || '').toLowerCase().indexOf('fa') === 0 ? 'fa' : 'en';
    }
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'fa' ? 'rtl' : 'ltr';
  } catch (e) { /* ignore */ }
})();
