// /<slug>/order/<id> and /<slug>/order/<id>/pay are BOTH a page the browser opens
// (after paying online) and JSON the page fetches. Same rule as the dev proxy in
// apps/store/vite.config.ts: a browser navigation (Accept: text/html) is served by
// the app from the S3 origin, everything else goes to the API under /store.
import cf from 'cloudfront';

function handler(event) {
  var request = event.request;
  var accept = request.headers['accept'] ? request.headers['accept'].value : '';
  if (request.method === 'GET' && accept.indexOf('text/html') !== -1) {
    cf.selectRequestOriginById('s3');
    request.uri = '/index.html';
    return request;
  }
  request.uri = '/store' + request.uri;
  return request;
}
