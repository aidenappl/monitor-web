"use client";

import { Provider } from "react-redux";
import { makeStore, AppStore } from "./index";

let store: AppStore | null = null;

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
  return <Provider store={storeInstance}>{children}</Provider>;
}
