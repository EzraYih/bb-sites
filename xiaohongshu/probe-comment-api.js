/* Level 3 feasibility probe - run this via bb-browser eval to check if noteRequest.post() works
 *
 * Usage:
 *   node "D:/2026/InnoSphere/02-Labs/bb-browser/dist/cli.js" --tab <tabId> eval "<script content>"
 *
 * Or save and run as a bb-browser site adapter:
 *   node ... site <(cat probe-comment-api.js) --note-id <id> --xsec-token <token>
 */

async function(args) {
  var noteId = args.note_id || args.noteId;
  var xsecToken = args.xsec_token || args.xsecToken;
  if (!noteId) return { error: "Missing note_id" };

  function getApp() { return document.querySelector("#app")?.__vue_app__ || null; }
  function getGlobals() { return getApp()?.config?.globalProperties || null; }
  function getPinia() { return getGlobals()?.$pinia || null; }
  function getStore(name) { return getPinia()?._s?.get(name) || null; }

  var ns = getStore("note");
  if (!ns) return { error: "Note store not found" };

  var report = {};

  // Check if noteRequest exists
  report.noteRequestExists = Boolean(ns.noteRequest);
  report.noteRequestType = typeof ns.noteRequest;

  if (ns.noteRequest) {
    // Enumerate methods on noteRequest
    var methods = [];
    for (var key in ns.noteRequest) {
      if (typeof ns.noteRequest[key] === "function") methods.push(key);
    }
    // Also check prototype chain
    var proto = Object.getPrototypeOf(ns.noteRequest);
    if (proto) {
      for (var key in proto) {
        if (typeof proto[key] === "function" && methods.indexOf(key) === -1) methods.push(key);
      }
    }
    report.noteRequestMethods = methods.sort();

    // Check for common HTTP method names
    report.hasPost = typeof ns.noteRequest.post === "function";
    report.hasGet = typeof ns.noteRequest.get === "function";
    report.hasRequest = typeof ns.noteRequest.request === "function";

    // Check if it'\''s an Axios instance
    report.isAxios = Boolean(ns.noteRequest.defaults);
    if (ns.noteRequest.defaults) {
      report.baseURL = ns.noteRequest.defaults.baseURL || null;
      report.defaultHeaders = JSON.parse(JSON.stringify(ns.noteRequest.defaults.headers?.common || {}));
    }
  }

  // Try calling getNoteDetailByNoteId through noteRequest if available
  if (ns.noteRequest && typeof ns.noteRequest.getNoteDetailByNoteId === "function") {
    report.canCallGetNoteDetail = true;
  } else {
    report.canCallGetNoteDetail = false;
  }

  // Check store actions
  var storeActions = [];
  for (var key in ns) {
    if (typeof ns[key] === "function" && key.indexOf("Comment") >= 0) storeActions.push(key);
  }
  report.commentStoreActions = storeActions;

  return report;
}
