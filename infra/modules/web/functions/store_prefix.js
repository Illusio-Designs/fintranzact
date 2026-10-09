// The store site calls /<slug>/catalog.json, /<slug>/policies.json, /<slug>/identify
// and /<slug>/order. The API serves them under /store (vite dev proxy does the same).
function handler(event) {
  var request = event.request;
  request.uri = '/store' + request.uri;
  return request;
}
