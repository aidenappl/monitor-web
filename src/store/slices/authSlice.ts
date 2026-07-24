import { User } from "@/types/auth.types";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "../index";

interface AuthState {
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;
}

const initialState: AuthState = {
  user: null,
  isLoggedIn: false,
  isLoading: true,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
      state.isLoggedIn = true;
      state.isLoading = false;
    },
    clearUser: (state) => {
      state.user = null;
      state.isLoggedIn = false;
      state.isLoading = false;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const selectUser = (state: RootState) => state.auth.user;
export const selectIsLoggedIn = (state: RootState) => state.auth.isLoggedIn;
export const selectIsLoading = (state: RootState) => state.auth.isLoading;

export const { setUser, clearUser, setLoading } = authSlice.actions;
export default authSlice.reducer;
