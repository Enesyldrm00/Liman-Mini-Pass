import {
  currentUserSchema,
  installationListSchema,
  repoPageSchema,
  type CurrentUser,
  type InstallationList,
  type RepoPage,
} from "@liman/shared";
import { getJson, isUnauthenticated, post } from "./client";

/** Where the sign-in button sends the browser; the API redirects on to GitHub. */
export const LOGIN_PATH = "/api/auth/github/login";

/** The signed-in user, or null when there is no valid session. */
export async function fetchMe(): Promise<CurrentUser | null> {
  try {
    return await getJson("/api/me", currentUserSchema);
  } catch (error) {
    if (isUnauthenticated(error)) {
      return null;
    }
    throw error;
  }
}

export function logout(): Promise<void> {
  return post("/api/auth/logout");
}

export function fetchInstallations(): Promise<InstallationList> {
  return getJson("/api/github/installations", installationListSchema);
}

/** One page of the repositories an installation can access; `cursor` comes from the last page. */
export function fetchRepos(installationId: string, cursor: string | null): Promise<RepoPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return getJson(
    `/api/github/installations/${encodeURIComponent(installationId)}/repos${query}`,
    repoPageSchema,
  );
}
