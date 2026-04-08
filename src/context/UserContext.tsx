"use client";

import { createContext, useContext } from "react";

export interface FortaUser {
    id: number;
    name: string | null;
    display_name: string | null;
    email: string;
    profile_image_url: string | null;
}

export const UserContext = createContext<FortaUser | null>(null);
export const useUser = () => useContext(UserContext);
