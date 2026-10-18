"use client";

import { Provider } from "react-redux";
import { makeStore, AppStore } from "./index";

let store: AppStore | null = null;

/**
 * ⚠️ WHAT THE SERVER RENDERED, for hydration. Without `serverState`, react-redux
 * hands a late-hydrating Suspense boundary (the Navbar, every zone page) the
 * LIVE store — and AuthProvider has often filled `user` by then — so the client
 * rendered the avatar menu and every `canWrite` control the server had not:
 * React #418 ("HTML"), on every signed-in page, timing-dependent. With it,
 * hydration renders the initial state and re-renders with the live one after.
 */
const SERVER_STATE = makeStore().getState();

export const getStore = () => {
  if (!store) {
    store = makeStore();
  }
  return store;
};

export default function StoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const storeInstance = getStore();
  return (
    <Provider store={storeInstance} serverState={SERVER_STATE}>
      {children}
    </Provider>
  );
}
