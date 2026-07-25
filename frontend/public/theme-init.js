(function () {
  var t = localStorage.getItem('theme');
  if (t === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    var m = document.getElementById('theme-color-meta');
    if (m) m.content = '#0f0f1a';
  }
})();
