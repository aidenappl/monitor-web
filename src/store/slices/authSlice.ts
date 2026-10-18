import { User } from "@/types/auth.types";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "../index";

interface AuthState {
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  /**
   * Why `/auth/self` could not be read, when the answer was a failure rather
   * than "not signed in" (a 5xx or no answer at all). Without it the account
   * page rendered "—" for the email and the role: a broken read presented as
   * an account with nothing in it.
   */
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isLoggedIn: false,
  isLoading: true,
  error: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
      state.isLoggedIn = true;
      state.isLoading = false;
      state.error = null;
    },
    clearUser: (state) => {
      state.user = null;
      state.isLoggedIn = false;
      state.isLoading = false;
      state.error = null;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
      if (action.payload) state.error = null;
    },
    setSelfError: (state, action: PayloadAction<string>) => {
      state.user = null;
      state.isLoading = false;
      state.error = action.payload;
    },
  },
});

export const selectUser = (state: RootState) => state.auth.user;
export const selectIsLoggedIn = (state: RootState) => state.auth.isLoggedIn;
export const selectIsLoading = (state: RootState) => state.auth.isLoading;
export const selectAuthError = (state: RootState) => state.auth.error;

export const { setUser, clearUser, setLoading, setSelfError } = authSlice.actions;
export default authSlice.reducer;
