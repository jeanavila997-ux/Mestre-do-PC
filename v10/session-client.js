(function () {
  if (window.__mestreSessionInstalled) return;
  var meta = document.querySelector('meta[name="mestre-session-token"]');
  var token = meta && meta.content;
  if (!token) return;
  window.__mestreSessionInstalled = true;
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var next = init ? Object.assign({}, init) : {};
    var headers = new Headers(next.headers || {});
    if (!headers.has("X-Mestre-Session")) headers.set("X-Mestre-Session", token);
    next.headers = headers;
    return orig(input, next);
  };
})();
