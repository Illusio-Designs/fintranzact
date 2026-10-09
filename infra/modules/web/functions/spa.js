// Single-page-app fallback. Paths without a file extension (/invoices, /help/gst,
// /my-bakery) are served by index.html; files (/assets/app.js, /favicon.svg) are not.
// Attached to the S3 behavior only, so API errors (401/403/404 JSON) are never rewritten.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var last = uri.split('/').pop();
  if (uri.charAt(uri.length - 1) === '/' || last.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
