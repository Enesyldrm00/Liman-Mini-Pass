import {
  appPageSchema,
  appSchema,
  branchPageSchema,
  currentUserSchema,
  envListSchema,
  installationListSchema,
  repoPageSchema,
  type App,
  type AppPage,
  type BranchPage,
  type CreateAppBody,
  type CurrentUser,
  type EnvList,
  type EnvPutBody,
  type InstallationList,
  type RepoPage,
} from "@liman/shared";
import { getJson, isUnauthenticated, post, sendJson } from "./client";

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

/** One page of a repository's branches. */
export function fetchBranches(
  installationId: string,
  repoId: number,
  cursor: string | null,
): Promise<BranchPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return getJson(
    `/api/github/installations/${encodeURIComponent(installationId)}/repos/${String(repoId)}/branches${query}`,
    branchPageSchema,
  );
}

export function fetchApps(cursor: string | null): Promise<AppPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return getJson(`/api/apps${query}`, appPageSchema);
}

const appPath = (id: string) => `/api/apps/${encodeURIComponent(id)}`;

export function fetchApp(id: string): Promise<App> {
  return getJson(appPath(id), appSchema);
}

export function createApp(body: CreateAppBody): Promise<App> {
  return sendJson("POST", "/api/apps", body, appSchema);
}

/** Marks the app `deleting`; the worker removes it in the background (202). */
export function deleteApp(id: string): Promise<App> {
  return sendJson("DELETE", appPath(id), undefined, appSchema);
}

/** Keys only: values never come back from the API. */
export function fetchEnv(appId: string): Promise<EnvList> {
  return getJson(`${appPath(appId)}/env`, envListSchema);
}

/** Replaces the whole list; a key without a value keeps its stored value. */
export function replaceEnv(appId: string, body: EnvPutBody): Promise<EnvList> {
  return sendJson("PUT", `${appPath(appId)}/env`, body, envListSchema);
}
