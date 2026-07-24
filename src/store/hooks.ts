import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./index";

// Use throughout the app instead of plain `useDispatch` and `useSelector`.
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

export const useAuth = () => {
  const dispatch = useAppDispatch();
  const isLoggedIn = useAppSelector((state) => state.auth.isLoggedIn);
  const user = useAppSelector((state) => state.auth.user);
  const isLoading = useAppSelector((state) => state.auth.isLoading);
  return { dispatch, isLoggedIn, user, isLoading };
};
