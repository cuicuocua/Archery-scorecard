// Build-time replacement for @supabase/realtime-js.
//
// This app has zero realtime call sites and will not gain any: Supabase
// Realtime filters by table-level RLS, not by the security-definer RPC
// that gates share tokens, so subscribing anonymous spectators would
// re-open the "enumerate every shared tournament" leak the RPC design
// exists to prevent (see README, v1.12). The public page polls instead,
// deliberately.
//
// supabase-js constructs a RealtimeClient unconditionally anyway, which
// dragged realtime-js and its phoenix websocket dependency — 55 KB — into
// every bundle, for every user, to be never spoken to again. This is
// aliased in over the real package by site/build.js.
//
// setAuth has to stay silent: supabase-js calls it on SIGNED_IN,
// INITIAL_SESSION and SIGNED_OUT, so throwing there would break sign-in.
// channel() is the opposite case — nothing internal calls it, so reaching
// it means someone is trying to use realtime and should be told that this
// build cannot, rather than watching a subscription quietly do nothing.
export class RealtimeClient {
  setAuth() {}
  getChannels() { return []; }
  removeChannel() { return Promise.resolve('ok'); }
  removeAllChannels() { return Promise.resolve([]); }
  channel() {
    throw new Error(
      'Realtime is stubbed out in this build (see site/realtime-stub.js). ' +
      'Restore the real @supabase/realtime-js in site/build.js before using channels.'
    );
  }
}
